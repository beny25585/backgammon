import asyncio
import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase

from game.consumers import GameConsumer, get_connected_snapshot, get_connection_identity
from game.engine import BackgammonEngine
from game.models import GameRoom, GameState, Match, Player, RoomPlayer
from game.consumers import _connected_user_colors, _connected_users


class ConnectionSnapshotTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='CON001', status='playing', target_points=1)
        self.user = User.objects.create_user('seat-user')
        player = Player.objects.create(user=self.user, nickname='Seat name')
        RoomPlayer.objects.create(room=self.room, player=player, color='white')
        self.state = BackgammonEngine.get_initial_state()
        self.state.update(version=4, phase='opening_roll')
        GameState.objects.create(room=self.room, state_data=self.state)

    def snapshot(self):
        return get_connected_snapshot.__wrapped__(self.room.id, 'test-channel', 'white')

    def test_identity_loads_assignment_and_names_without_fetching_game_state(self):
        with self.assertNumQueries(2):
            room, color, names = get_connection_identity.__wrapped__(self.room.id, self.user.id)
        self.assertEqual((room.id, color), (self.room.id, 'white'))
        self.assertEqual(names, {'white': 'Seat name', 'black': None})

    def test_unassigned_and_invalid_room_identity_are_read_only(self):
        _, color, _ = get_connection_identity.__wrapped__(self.room.id, self.user.id + 100)
        self.assertIsNone(color)
        self.assertIsNone(get_connection_identity.__wrapped__('invalid', self.user.id)[0])
        self.room.refresh_from_db()
        self.assertEqual(self.room.state, {})
        self.assertEqual(GameState.objects.get(room=self.room).state_data, self.state)

    def test_reconnect_reads_new_version_instead_of_earlier_identity_snapshot(self):
        get_connection_identity.__wrapped__(self.room.id, self.user.id)
        new_state = {**self.state, 'version': 5, 'home': {'white': 2, 'black': 0},
                     'phase': 'moving', 'turn': 'white',
                     'clock': {'white': 45678, 'black': 60000}, 'turnStartedAt': 100000}
        GameState.objects.filter(room=self.room).update(state_data=new_state)
        with patch('game.consumers.time_module.time', return_value=101):
            _, snapshot, paused, timed_out = self.snapshot()
        self.assertFalse(paused)
        self.assertIsNone(timed_out)
        self.assertEqual(snapshot, new_state)
        self.assertEqual(GameState.objects.get(room=self.room).state_data, new_state)
        self.room.refresh_from_db()
        self.assertIn('test-channel', self.room.state['presence']['connections'])

    def test_missing_clock_is_normalized_once_without_resetting_board(self):
        with patch('game.consumers.time_module.time', return_value=100):
            _, first, _, _ = self.snapshot()
        self.assertEqual(first['clock'], {'white': 60000, 'black': 60000})
        self.assertEqual(first['version'], 4)
        first['clock']['white'] = 12345
        GameState.objects.filter(room=self.room).update(state_data=first)
        with patch('game.consumers.time_module.time', return_value=101):
            _, second, _, _ = self.snapshot()
        self.assertEqual(second['clock']['white'], 12345)
        self.assertEqual(second['points'], self.state['points'])

    def test_organizer_pause_does_not_seed_or_restart_a_clock(self):
        self.room.state = {'presence': {'needsAdminAdjudication': True}}
        self.room.save(update_fields=['state'])
        _, snapshot, paused, timed_out = self.snapshot()
        self.assertTrue(paused)
        self.assertIsNone(timed_out)
        self.assertNotIn('clock', snapshot)

    def test_expired_admission_does_not_create_a_snapshot(self):
        with patch('game.consumers.mark_connected', return_value=False):
            self.assertIsNone(self.snapshot())
        self.assertEqual(GameState.objects.get(room=self.room).state_data, self.state)

    def test_reconnect_and_repeated_finalization_do_not_score_a_finished_game_twice(self):
        from game.game_service import record_game_end
        final = {**self.state, 'phase': 'game_over', 'winner': 'white',
                 'home': {'white': 15, 'black': 1}}
        with patch('game.game_service.enqueue_match_analysis'):
            first = record_game_end(self.room, final, 'white', 'single', 'move')
            self.assertTrue(first['match_over'])
            _, snapshot, _, _ = self.snapshot()
            second = record_game_end(self.room, final, 'white', 'single', 'move')
        self.assertIsNone(second)
        self.assertEqual(snapshot['winner'], 'white')
        self.assertTrue(snapshot['matchScored'])
        self.room.refresh_from_db()
        self.assertEqual((self.room.white_score, self.room.black_score), (1, 0))
        self.assertEqual(Match.objects.filter(room=self.room).count(), 1)


class ConnectionDispatchTests(SimpleTestCase):
    def consumer(self):
        consumer = GameConsumer()
        room_id = str(uuid.uuid4())
        consumer.scope = {'query_string': b'token=test', 'url_route': {'kwargs': {'room_id': room_id}}}
        consumer.channel_name = 'test-channel'
        consumer.channel_layer = SimpleNamespace(group_add=AsyncMock(), group_send=AsyncMock())
        consumer.accept = AsyncMock()
        consumer.close = AsyncMock()
        consumer.send = AsyncMock()
        consumer._broadcast_room_status = AsyncMock()
        consumer._presence_heartbeat = AsyncMock()
        room = SimpleNamespace(id=room_id, tournament_link=None, status='playing', state={},
                               white_score=0, black_score=0, target_points=1, time_control='normal')
        return consumer, room

    async def test_authorization_precedes_accept_and_fresh_snapshot_is_sent(self):
        consumer, room = self.consumer()
        snapshot = {'phase': 'opening_roll', 'version': 9, 'points': [0] * 24}
        try:
            with patch('game.consumers.get_user_id_from_token', return_value=7), \
                    patch('game.consumers.get_connection_identity',
                          AsyncMock(return_value=(room, 'white', {'white': 'Seat', 'black': 'Opponent'}))) as identity, \
                    patch('game.consumers.get_connected_snapshot',
                          AsyncMock(return_value=(room, snapshot, False, None))) as connected, \
                    patch('game.consumers.get_username', AsyncMock()) as username:
                await consumer.connect()
            identity.assert_awaited_once_with(room.id, 7)
            connected.assert_awaited_once_with(room.id, 'test-channel', 'white')
            consumer.accept.assert_awaited_once()
            username.assert_not_awaited()
            first = json.loads(consumer.send.call_args_list[0].args[0])
            self.assertTrue(first['initial'])
            self.assertEqual(first['payload']['version'], 9)
        finally:
            # Direct unit invocation has no Channels disconnect dispatch.
            await self.clean_consumer(consumer)

    async def clean_consumer(self, consumer):
        if hasattr(consumer, '_presence_heartbeat_task'):
            consumer._presence_heartbeat_task.cancel()
            await asyncio.gather(consumer._presence_heartbeat_task, return_exceptions=True)
        _connected_users.pop(getattr(consumer, 'room_group_name', None), None)
        _connected_user_colors.pop(getattr(consumer, 'room_group_name', None), None)

    async def test_unassigned_user_is_refused_before_accept_or_presence_write(self):
        consumer, room = self.consumer()
        with patch('game.consumers.get_user_id_from_token', return_value=7), \
                patch('game.consumers.get_connection_identity', AsyncMock(return_value=(room, None, {}))), \
                patch('game.consumers.get_connected_snapshot', AsyncMock()) as connected:
            await consumer.connect()
        consumer.accept.assert_not_awaited()
        connected.assert_not_awaited()
        consumer.close.assert_awaited_once_with(code=4003)

    async def test_canceled_connection_cleans_its_seat_and_timer(self):
        consumer, room = self.consumer()
        consumer.room_id = room.id
        consumer.room_group_name = f'game_{room.id}'
        consumer.user_id = 7
        _connected_users[consumer.room_group_name] = {7: {'test-channel'}}
        _connected_user_colors[consumer.room_group_name] = {7: 'white'}
        consumer._presence_heartbeat_task = asyncio.create_task(asyncio.Event().wait())
        async def remove_seat(code):
            _connected_users.pop(consumer.room_group_name, None)
            _connected_user_colors.pop(consumer.room_group_name, None)
        consumer.disconnect = AsyncMock(side_effect=remove_seat)
        try:
            with patch('channels.generic.websocket.AsyncWebsocketConsumer.__call__',
                       AsyncMock(side_effect=asyncio.CancelledError)), self.assertRaises(asyncio.CancelledError):
                await consumer({}, AsyncMock(), AsyncMock())
            consumer.disconnect.assert_awaited_once_with(1001)
            self.assertTrue(consumer._presence_heartbeat_task.done())
            self.assertNotIn(consumer.room_group_name, _connected_users)
        finally:
            await self.clean_consumer(consumer)
