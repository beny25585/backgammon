import copy
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

    async def fake_board(self, state, difficulty):
        engine = BackgammonEngine(copy.deepcopy(state))
        while engine.state['turn'] == 'black' and engine.state['phase'] == 'moving' and engine.state['remaining']:
            move = engine.all_legal_moves('black')[0]
            engine.make_move(move['from'], move['to'], 'black')
        return native_board(engine.state, 'black')

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
            await next_comm.disconnect()

    async def test_stranger_rejected(self):
        stranger = await database_sync_to_async(User.objects.create_user)('ai-stranger')
        token = str(AccessToken.for_user(stranger))
        comm = self.communicator(token)
        connected, code = await comm.connect()
        self.assertFalse(connected)
        self.assertEqual(code, 4003)
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
