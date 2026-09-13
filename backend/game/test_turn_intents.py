"""Turn obligations are enforced at the websocket and persistence boundary."""
from urllib.parse import urlencode

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TransactionTestCase
from rest_framework_simplejwt.tokens import AccessToken

from game.consumers import GameConsumer
from game.engine import BackgammonEngine
from game.models import GameRoom, GameState, Player, RoomPlayer


class TurnIntentTests(TransactionTestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='turn-white')
        player = Player.objects.create(user=self.user)
        self.room = GameRoom.objects.create(code='TURN01', status='playing', time_control='none')
        RoomPlayer.objects.create(room=self.room, player=player, color='white')
        GameState.objects.create(room=self.room, state_data=BackgammonEngine.get_initial_state())
        self.token = str(AccessToken.for_user(self.user))

    async def connect(self, **overrides):
        state = BackgammonEngine.get_initial_state()
        state.update(phase='moving', turn='white', dice=[3, 5], remaining=[3, 5])
        state.update(overrides)
        await database_sync_to_async(GameState.objects.filter(room=self.room).update)(state_data=state)
        comm = WebsocketCommunicator(
            GameConsumer.as_asgi(), f'/ws/game/{self.room.id}/?{urlencode({"token": self.token})}',
        )
        comm.scope['url_route'] = {'kwargs': {'room_id': str(self.room.id)}, 'args': ()}
        connected, _ = await comm.connect(timeout=10)
        self.assertTrue(connected)
        await self.receive(comm, 'state_update')
        return comm

    async def receive(self, comm, event_type, action=None):
        for _ in range(20):
            event = await comm.receive_json_from(timeout=5)
            if event.get('type') == event_type and (action is None or event.get('action') == action):
                return event
        self.fail(f'Did not receive {event_type}/{action}')

    @database_sync_to_async
    def snapshot(self):
        self.room.refresh_from_db()
        return (GameState.objects.get(room=self.room).state_data, self.room.last_sequence,
                self.room.status, self.room.white_score, self.room.black_score)

    async def intent(self, comm, action, **payload):
        await comm.send_json_to({'type': 'state_update', 'payload': {'action': action, **payload}})

    async def assert_rejected_unchanged(self, comm, action, **payload):
        before = await self.snapshot()
        await self.intent(comm, action, **payload)
        await self.receive(comm, 'error')
        self.assertEqual(await self.snapshot(), before)

    async def test_cannot_end_early_but_complete_sequence_can_end(self):
        comm = await self.connect()
        try:
            await self.assert_rejected_unchanged(comm, 'end_turn')
            await self.intent(comm, 'move', **{'from': 12, 'to': 9})
            first = await self.receive(comm, 'state_update', 'move')
            self.assertEqual(first['payload']['remaining'], [5])
            await self.assert_rejected_unchanged(comm, 'end_turn')
            await self.intent(comm, 'move', **{'from': 12, 'to': 7})
            second = await self.receive(comm, 'state_update', 'move')
            self.assertEqual(second['payload']['remaining'], [])
            await self.intent(comm, 'end_turn')
            ended = await self.receive(comm, 'state_update', 'end_turn')
            self.assertEqual((ended['payload']['phase'], ended['payload']['turn']), ('rolling', 'black'))
            self.assertEqual((await self.snapshot())[1], 3)
        finally:
            await comm.disconnect()

    async def test_lower_die_rejected_when_only_higher_die_may_be_used(self):
        points = [0] * 24
        points[3], points[0] = 1, -2
        comm = await self.connect(points=points, home={'white': 14, 'black': 13},
                                  dice=[1, 2], remaining=[1, 2])
        try:
            await self.assert_rejected_unchanged(comm, 'move', **{'from': 3, 'to': 2})
            await self.intent(comm, 'move', **{'from': 3, 'to': 1})
            moved = await self.receive(comm, 'state_update', 'move')
            self.assertEqual(moved['payload']['points'][1], 1)
            self.assertEqual(moved['payload']['turn'], 'black')
            self.assertEqual((await self.snapshot())[1], 1)
        finally:
            await comm.disconnect()

    async def test_cannot_bear_off_last_checker_before_using_both_dice(self):
        points = [0] * 24
        points[1] = 1
        comm = await self.connect(points=points, home={'white': 14, 'black': 15},
                                  dice=[2, 1], remaining=[2, 1])
        try:
            await self.assert_rejected_unchanged(comm, 'move', **{'from': 1, 'to': 'off'})
            await self.intent(comm, 'move', **{'from': 1, 'to': 0})
            moved = await self.receive(comm, 'state_update', 'move')
            self.assertEqual(moved['payload']['remaining'], [2])
            await self.intent(comm, 'move', **{'from': 0, 'to': 'off'})
            ended = await self.receive(comm, 'game_ended')
            self.assertEqual(ended['payload']['winner'], 'white')
            self.assertEqual((await self.snapshot())[0]['home']['white'], 15)
        finally:
            await comm.disconnect()

    async def test_wrong_phase_rejects_move_and_end_turn(self):
        comm = await self.connect(phase='rolling')
        try:
            await self.assert_rejected_unchanged(comm, 'move', **{'from': 12, 'to': 9})
            await self.assert_rejected_unchanged(comm, 'end_turn')
        finally:
            await comm.disconnect()

    async def test_wrong_player_rejects_move_and_end_turn(self):
        comm = await self.connect(turn='black')
        try:
            await self.assert_rejected_unchanged(comm, 'move', **{'from': 12, 'to': 9})
            await self.assert_rejected_unchanged(comm, 'end_turn')
        finally:
            await comm.disconnect()
