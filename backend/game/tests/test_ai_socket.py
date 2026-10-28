import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from game.ai import native_board
from game.ai_consumer import PracticeGameConsumer
from game.engine import BackgammonEngine
from game.models import AiSession, GameRoom, GameState, Player, RoomPlayer


class PracticeSocketTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user('ai-socket-human')
        player = Player.objects.create(user=self.user)
        self.room = GameRoom.objects.create(code='AISOCK', status='playing', target_points=1,
            time_control='none', state={'ai': {'difficulty': 'hard'}})
        AiSession.objects.create(room=self.room)
        RoomPlayer.objects.create(room=self.room, player=player, color='white')
        state = BackgammonEngine.get_initial_state()
        state.update(turn='black', phase='rolling', doublingEnabled=False)
        GameState.objects.create(room=self.room, state_data=state)
        self.token = str(AccessToken.for_user(self.user))

    def communicator(self, token=None):
        comm = WebsocketCommunicator(PracticeGameConsumer.as_asgi(),
            f'/ws/game/{self.room.id}/?token={token or self.token}')
        comm.scope['url_route'] = {'kwargs': {'room_id': str(self.room.id)}, 'args': ()}
        return comm

    async def receive_until(self, comm, predicate):
        for _ in range(30):
            event = await comm.receive_json_from(timeout=5)
            if predicate(event):
                return event
        self.fail('Expected event missing')

    async def fake_board(self, state, difficulty, match=None):
        engine = BackgammonEngine(copy.deepcopy(state))
        while engine.state['turn'] == 'black' and engine.state['phase'] == 'moving' and engine.state['remaining']:
            move = engine.all_legal_moves('black')[0]
            engine.make_move(move['from'], move['to'], 'black')
        return native_board(engine.state, 'black')

    def bot_consumer(self):
        consumer = PracticeGameConsumer()
        consumer.room_id = str(self.room.id)
        consumer.room_group_name = f'game_{self.room.id}'
        consumer.channel_layer = SimpleNamespace(group_send=AsyncMock())
        consumer.is_ai = True
        consumer._ai_task = asyncio.current_task()
        consumer._ai_disconnected = False
        consumer._ai_failed = False
        return consumer

    async def assert_bot_released_lease(self, consumer):
        self.assertFalse(consumer._ai_failed)
        session = await database_sync_to_async(AiSession.objects.get)(room=self.room)
        self.assertIsNone(session.lease_until)
        self.assertEqual(session.lease_token, '')

    async def test_bot_releases_human_turn_without_final_action_delay(self):
        state = BackgammonEngine.get_initial_state()
        state.update(turn='black', phase='moving', dice=[3, 1], remaining=[], doublingEnabled=False)
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        consumer = self.bot_consumer()
        sleep = AsyncMock()

        with patch('game.ai_consumer.asyncio', SimpleNamespace(sleep=sleep)):
            await consumer._play_bot()

        sleep.assert_not_awaited()
        stored = await database_sync_to_async(GameState.objects.get)(room=self.room)
        self.assertEqual((stored.state_data['phase'], stored.state_data['turn']), ('rolling', 'white'))
        await self.assert_bot_released_lease(consumer)

    async def test_blocked_bot_roll_releases_human_turn_without_delay(self):
        state = BackgammonEngine.get_initial_state()
        state.update(turn='black', phase='rolling', doublingEnabled=False,
            points=[5, 5, 5] + [0] * 21, bar={'white': 0, 'black': 15},
            home={'white': 0, 'black': 0})
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        consumer = self.bot_consumer()
        sleep = AsyncMock()

        with patch('game.ai_consumer.asyncio', SimpleNamespace(sleep=sleep)), patch(
                'game.consumers.fetch_turn_dice', new=AsyncMock(return_value=(3, 1))):
            await consumer._play_bot()

        sleep.assert_not_awaited()
        stored = await database_sync_to_async(GameState.objects.get)(room=self.room)
        self.assertEqual((stored.state_data['phase'], stored.state_data['turn']), ('rolling', 'white'))
        self.assertEqual(stored.state_data['bar']['black'], 15)
        await self.assert_bot_released_lease(consumer)

    async def test_bot_keeps_action_delays_only_during_its_turn(self):
        consumer = self.bot_consumer()
        delayed_states = []

        async def capture_action_delay(delay):
            stored = await database_sync_to_async(GameState.objects.get)(room=self.room)
            delayed_states.append((delay, copy.deepcopy(stored.state_data)))

        sleep = AsyncMock(side_effect=capture_action_delay)
        with patch('game.ai_consumer.asyncio', SimpleNamespace(sleep=sleep)), patch(
                'game.ai.request_board', side_effect=self.fake_board), patch(
                'game.consumers.fetch_turn_dice', new=AsyncMock(return_value=(3, 1))):
            await consumer._play_bot()

        self.assertGreaterEqual(len(delayed_states), 2)
        self.assertEqual(delayed_states[0][1]['phase'], 'moving')
        self.assertEqual(delayed_states[0][1]['remaining'], [3, 1])
        self.assertTrue(all(delay == 1.5 and state['turn'] == 'black'
            for delay, state in delayed_states))
        stored = await database_sync_to_async(GameState.objects.get)(room=self.room)
        self.assertEqual((stored.state_data['phase'], stored.state_data['turn']), ('rolling', 'white'))
        await self.assert_bot_released_lease(consumer)

    async def test_human_opening_winner_still_advances_through_result_watch(self):
        state = BackgammonEngine.get_initial_state()
        state.update(turn='black', phase='opening_roll', doublingEnabled=False,
            openingRoll={'white': 6, 'black': None}, openingDice=[6, 1])
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        consumer = self.bot_consumer()
        sleep = AsyncMock()

        with patch('game.ai_consumer.asyncio', SimpleNamespace(sleep=sleep)), patch(
                'game.consumers.GameConsumer.OPENING_RESULT_DELAY', 0.01):
            await consumer._play_bot()

        sleep.assert_awaited_once_with(1.5)
        stored = await database_sync_to_async(GameState.objects.get)(room=self.room)
        self.assertEqual((stored.state_data['phase'], stored.state_data['turn']), ('moving', 'white'))
        self.assertEqual(stored.state_data['dice'], [6, 1])
        await self.assert_bot_released_lease(consumer)

    async def test_bot_rolls_moves_confirms_and_reconnects(self):
        with patch('game.ai.request_board', side_effect=self.fake_board), patch(
                'game.consumers.fetch_turn_dice', new=AsyncMock(return_value=(3, 1))):
            comm = self.communicator()
            self.assertTrue((await comm.connect())[0])
            event = await self.receive_until(comm, lambda e: e.get('type') == 'state_update'
                and e.get('payload', {}).get('turn') == 'white'
                and e.get('payload', {}).get('phase') == 'rolling')
            board = event['payload']['points']
            await comm.disconnect()
            next_comm = self.communicator()
            self.assertTrue((await next_comm.connect())[0])
            initial = await self.receive_until(next_comm, lambda e: e.get('initial'))
            self.assertEqual(initial['payload']['points'], board)
            self.assertEqual(initial['playerColor'], 'white')
            self.assertEqual(initial['players']['black'], 'Open Sage')
            await next_comm.disconnect()

    async def test_stranger_rejected(self):
        stranger = await database_sync_to_async(User.objects.create_user)('ai-stranger')
        token = str(AccessToken.for_user(stranger))
        comm = self.communicator(token)
        connected, code = await comm.connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4003)
        await comm.disconnect()

    async def test_unpaid_room_cannot_connect(self):
        await database_sync_to_async(GameRoom.objects.filter(pk=self.room.pk).update)(status='waiting')
        comm = self.communicator()
        connected, code = await comm.connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4003)
        await comm.disconnect()

    async def test_bot_offers_double_and_waits_for_human(self):
        state = BackgammonEngine.get_initial_state()
        state.update(phase='rolling', turn='black', doublingEnabled=True, maxCube=64)
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        await database_sync_to_async(GameRoom.objects.filter(pk=self.room.pk).update)(target_points=5)
        with patch('game.ai.request_decision', new=AsyncMock(return_value={'should_double': True, 'should_take': True})):
            comm = self.communicator()
            self.assertTrue((await comm.connect())[0])
            event = await self.receive_until(comm, lambda e: e.get('payload', {}).get('phase') == 'doubling_offered')
            self.assertEqual(event['payload']['doubleOfferedBy'], 'black')
            await comm.disconnect()

    async def test_bot_takes_human_double(self):
        state = BackgammonEngine.get_initial_state()
        state.update(phase='doubling_offered', turn='white', doubleOfferedBy='white', doublingEnabled=True, maxCube=64)
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        with patch('game.ai.request_decision', new=AsyncMock(return_value={'should_take': True})):
            comm = self.communicator()
            self.assertTrue((await comm.connect())[0])
            event = await self.receive_until(comm, lambda e: e.get('payload', {}).get('cube') == 2)
            self.assertEqual(event['payload']['cubeOwner'], 'black')
            self.assertEqual(event['payload']['turn'], 'white')
            await comm.disconnect()

    async def test_retry_after_failure_continues_same_roll(self):
        state = BackgammonEngine.get_initial_state()
        state.update(phase='moving', turn='black', dice=[2, 2], remaining=[2] * 4, doublingEnabled=False)
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        comm = self.communicator()
        with patch('game.ai.request_board', new=AsyncMock(side_effect=RuntimeError('offline'))):
            self.assertTrue((await comm.connect())[0])
            await self.receive_until(comm, lambda e: e.get('type') == 'error')
        with patch('game.ai.request_board', side_effect=self.fake_board), patch('game.consumers.fetch_turn_dice') as dice:
            await comm.send_json_to({'type': 'ai_retry'})
            await self.receive_until(comm, lambda e: e.get('type') == 'state_update'
                and e.get('payload', {}).get('turn') == 'white')
            dice.assert_not_called()
        await comm.disconnect()

    async def test_bot_declines_double_and_scores_old_cube(self):
        state = BackgammonEngine.get_initial_state()
        state.update(phase='doubling_offered', turn='white', doubleOfferedBy='white',
            doublingEnabled=True, maxCube=64, cube=2, gameFormat='match')
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        with patch('game.ai.request_decision', new=AsyncMock(return_value={'should_take': False})):
            comm = self.communicator()
            self.assertTrue((await comm.connect())[0])
            event = await self.receive_until(comm, lambda e: e.get('type') == 'game_ended')
            self.assertEqual(event['payload']['winner'], 'white')
            stored = await database_sync_to_async(GameRoom.objects.get)(pk=self.room.pk)
            self.assertEqual(stored.white_score, 2)
            await comm.disconnect()

    async def test_opening_roll_bot_wins_and_plays_deciding_dice(self):
        initial = BackgammonEngine.get_initial_state()
        initial['doublingEnabled'] = False
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=initial)
        with patch('game.ai.request_board', side_effect=self.fake_board), patch(
                'game.consumers.fetch_opening_dice', new=AsyncMock(return_value=(1, 6))), patch(
                'game.consumers.GameConsumer.OPENING_RESULT_DELAY', 0.01):
            comm = self.communicator()
            self.assertTrue((await comm.connect())[0])
            await self.receive_until(comm, lambda e: e.get('initial'))
            await comm.send_json_to({'type': 'state_update', 'action': 'roll'})
            await self.receive_until(comm, lambda e: e.get('type') == 'state_update'
                and e.get('payload', {}).get('phase') == 'rolling'
                and e.get('payload', {}).get('turn') == 'white')
            stored = await database_sync_to_async(GameState.objects.get)(room=self.room)
            self.assertEqual(stored.state_data['openingRoll'], {'white': 1, 'black': 6})
            self.assertNotEqual(stored.state_data['points'], initial['points'])
            await comm.disconnect()

    async def test_failure_preserves_board_and_reports_error(self):
        with patch('game.ai.request_board', new=AsyncMock(side_effect=RuntimeError('offline'))), patch(
                'game.consumers.fetch_turn_dice', new=AsyncMock(return_value=(3, 1))):
            comm = self.communicator()
            self.assertTrue((await comm.connect())[0])
            await self.receive_until(comm, lambda e: e.get('type') == 'error')
            stored = await database_sync_to_async(GameState.objects.get)(room=self.room)
            self.assertEqual(stored.state_data['points'], BackgammonEngine.get_initial_state()['points'])
            self.assertEqual(stored.state_data['remaining'], [3, 1])
            await comm.disconnect()
