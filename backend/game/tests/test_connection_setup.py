import asyncio
import json
import uuid
from time import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from asgiref.sync import async_to_sync
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from django.test import SimpleTestCase, TestCase, TransactionTestCase
from django.utils import timezone

from game.consumers import GameConsumer, get_connected_snapshot, get_connection_identity
from game.engine import BackgammonEngine
from game.event_history import persist_game_action
from game.link.models import TournamentLink
from game.models import GameEvent, GameRoom, GameState, Match, Player, RoomPlayer
from game.presence import STALE_SECONDS
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


class TournamentOpeningDispatchTests(TransactionTestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='OPEN01', status='playing')
        self.link = TournamentLink.objects.create(
            issuer='tournaments', tournament_id=17, fixture_id=482, room=self.room,
        )
        for color in ('white', 'black'):
            player = Player.objects.create(user=User.objects.create_user(f'opening-{color}'))
            RoomPlayer.objects.create(room=self.room, player=player, color=color)
        self.state = GameState.objects.create(
            room=self.room, state_data=BackgammonEngine.get_initial_state(),
        )

    def receive_roll(self, color='white', *, opponent_fresh=True):
        now = time()
        opponent = 'black' if color == 'white' else 'white'
        self.room.state = {
            'presence': {
                'everBothConnected': True,
                'connections': {
                    'acting-seat': {'color': color, 'lastSeen': now},
                    'opponent-seat': {
                        'color': opponent,
                        'lastSeen': now if opponent_fresh else now - STALE_SECONDS - 1,
                    },
                },
            },
        }
        self.room.save(update_fields=['state'])
        consumer = GameConsumer()
        consumer.room_id = str(self.room.pk)
        consumer.room_group_name = f'game_{self.room.pk}'
        consumer.linked_tournament_id = self.link.tournament_id
        consumer.player_color = color
        consumer.send = AsyncMock()
        consumer.channel_layer = SimpleNamespace(group_send=AsyncMock())
        consumer._arm_opening_result_watch = AsyncMock()
        async_to_sync(consumer.receive)(json.dumps({
            'type': 'state_update', 'payload': {'action': 'roll'},
        }))
        self.room.refresh_from_db()
        self.state.refresh_from_db()
        return consumer

    def test_one_tournament_intent_persists_both_dice_and_broadcasts_once(self):
        with patch('game.consumers.fetch_opening_dice', AsyncMock(return_value=(6, 2))) as dice:
            consumer = self.receive_roll()
        dice.assert_awaited_once()
        self.assertEqual(self.state.state_data['openingRoll'], {'white': 6, 'black': 2})
        self.assertEqual(self.state.state_data['phase'], 'opening_result')
        self.assertEqual(self.state.state_data['dice'], [6, 2])
        self.assertIsNone(self.state.state_data['turnStartedAt'])
        self.assertEqual(self.room.last_sequence, 1)
        self.assertEqual(GameEvent.objects.filter(room=self.room, event_type='roll').count(), 1)
        consumer._arm_opening_result_watch.assert_awaited_once()
        consumer.channel_layer.group_send.assert_awaited_once()
        event = consumer.channel_layer.group_send.call_args.args[1]
        self.assertEqual(event['payload']['openingRoll'], {'white': 6, 'black': 2})

    def test_tournament_opening_finishes_using_the_existing_pair(self):
        engine = BackgammonEngine(self.state.state_data)
        engine.roll_opening_die('white', die=5)
        self.state.state_data = {**engine.state, 'openingDice': [5, 3]}
        self.state.save(update_fields=['state_data'])
        self.room.last_sequence = 1
        self.room.save(update_fields=['last_sequence'])
        with patch('game.consumers.fetch_opening_dice', AsyncMock()) as dice:
            self.receive_roll('black')
        dice.assert_not_awaited()
        self.assertEqual(self.state.state_data['openingRoll'], {'white': 5, 'black': 3})
        self.assertEqual(self.state.state_data['phase'], 'opening_result')
        self.assertEqual(self.room.last_sequence, 2)

    def test_pending_tournament_roll_cannot_replace_a_committed_pair(self):
        first = BackgammonEngine(BackgammonEngine.get_initial_state())
        first.state['gameId'] = self.state.state_data['gameId']
        first.roll_opening_die('white', die=5)
        first.roll_opening_die('black', die=1)

        async def finish_competing_roll():
            await database_sync_to_async(persist_game_action)(
                self.room.pk, first.state, 'white', 'roll',
            )
            return 6, 2

        with patch('game.consumers.fetch_opening_dice', side_effect=finish_competing_roll):
            consumer = self.receive_roll()
        self.assertEqual(self.state.state_data['openingRoll'], {'white': 5, 'black': 1})
        self.assertEqual(self.room.last_sequence, 1)
        self.assertEqual(GameEvent.objects.filter(room=self.room, event_type='roll').count(), 1)
        consumer._arm_opening_result_watch.assert_not_awaited()
        consumer.channel_layer.group_send.assert_awaited_once()
        self.assertEqual(consumer.channel_layer.group_send.call_args.args[1]['type'], 'room_status')

    def test_started_tournament_opens_and_starts_the_clock_after_one_disconnect(self):
        with patch('game.consumers.fetch_opening_dice', AsyncMock(return_value=(6, 2))) as dice:
            consumer = self.receive_roll(opponent_fresh=False)
        dice.assert_awaited_once()
        self.assertEqual(self.state.state_data['openingRoll'], {'white': 6, 'black': 2})
        self.assertEqual(self.state.state_data['phase'], 'opening_result')
        self.assertIsNone(self.state.state_data['turnStartedAt'])
        opening_clock = self.state.state_data['clock']

        consumer._reschedule_timeout_from_state = AsyncMock()
        before = int(time() * 1000)
        with patch('game.consumers.ensure_inactivity_check', return_value=False) as inactivity:
            async_to_sync(consumer._activate_opening_move)()
        self.state.refresh_from_db()
        self.room.refresh_from_db()

        self.assertEqual(self.state.state_data['phase'], 'moving')
        self.assertEqual(self.state.state_data['turn'], 'white')
        self.assertEqual(self.state.state_data['dice'], [6, 2])
        self.assertEqual(self.state.state_data['clock'], opening_clock)
        self.assertGreaterEqual(self.state.state_data['turnStartedAt'], before)
        self.assertEqual(self.state.state_data['inactivity']['player'], 'white')
        self.assertEqual(self.room.last_sequence, 2)
        self.assertEqual(
            list(GameEvent.objects.filter(room=self.room).order_by('sequence').values_list('event_type', flat=True)),
            ['roll', 'opening_result_done'],
        )
        inactivity.assert_called_once_with(self.room.pk)
        consumer._reschedule_timeout_from_state.assert_awaited_once()

    def test_tournament_opening_clock_stays_stopped_during_admin_hold(self):
        with patch('game.consumers.fetch_opening_dice', AsyncMock(return_value=(6, 2))):
            consumer = self.receive_roll()
        self.room.state['presence']['needsAdminAdjudication'] = True
        self.room.save(update_fields=['state'])
        consumer._reschedule_timeout_from_state = AsyncMock()

        with patch('game.consumers.ensure_inactivity_check') as inactivity:
            async_to_sync(consumer._activate_opening_move)()
        self.state.refresh_from_db()
        self.room.refresh_from_db()

        self.assertEqual(self.state.state_data['phase'], 'opening_result')
        self.assertIsNone(self.state.state_data['turnStartedAt'])
        self.assertEqual(self.room.last_sequence, 1)
        inactivity.assert_not_called()
        consumer._reschedule_timeout_from_state.assert_not_awaited()

    def test_direct_game_still_reveals_only_the_acting_players_die(self):
        self.link.tournament_id = 0
        self.link.save(update_fields=['tournament_id'])
        with patch('game.consumers.fetch_opening_dice', AsyncMock(return_value=(6, 2))) as dice:
            self.receive_roll()
        dice.assert_awaited_once()
        self.assertEqual(self.state.state_data['openingRoll'], {'white': 6, 'black': None})
        self.assertEqual(self.state.state_data['phase'], 'opening_roll')
        self.assertEqual(self.state.state_data['turn'], 'black')


class ConnectionDispatchTests(SimpleTestCase):
    async def test_waiting_game_cannot_fetch_or_roll_opening_dice(self):
        consumer = GameConsumer()
        consumer.room_id = str(uuid.uuid4())
        consumer._send_error = AsyncMock()
        room = SimpleNamespace(status='waiting')
        with patch('game.consumers.get_game_state', AsyncMock()) as state, \
                patch('game.consumers.fetch_opening_dice', AsyncMock()) as dice:
            await consumer._handle_intent({'action': 'roll'}, context=(room, None))
        state.assert_not_awaited()
        dice.assert_not_awaited()
        consumer._send_error.assert_awaited_once_with('entry_waiting_for_players')

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
            self.assertEqual(first['roomStatus'], 'playing')
            self.assertFalse(first['entryConfirmationRequired'])
        finally:
            # Direct unit invocation has no Channels disconnect dispatch.
            await self.clean_consumer(consumer)

    async def test_heartbeat_delivers_a_missed_entry_start_only_once(self):
        consumer = GameConsumer()
        consumer.room_id = str(uuid.uuid4())
        consumer.channel_name = 'test-channel'
        consumer.entry_confirmation_required = True
        consumer.entry_start_notified = False
        consumer.send = AsyncMock()
        heartbeat = AsyncMock(side_effect=['waiting', 'playing', 'playing', asyncio.CancelledError])
        with patch('game.consumers.HEARTBEAT_SECONDS', 0), \
                patch('game.consumers.database_sync_to_async', return_value=heartbeat):
            with self.assertRaises(asyncio.CancelledError):
                await consumer._presence_heartbeat()

        consumer.send.assert_awaited_once()
        self.assertEqual(json.loads(consumer.send.call_args.args[0]), {'type': 'room_started', 'payload': {}})

    async def test_tournament_room_status_uses_presence_shared_between_workers(self):
        consumer, room = self.consumer()
        consumer.room_id = room.id
        consumer.room_group_name = f'game_{room.id}'
        consumer.linked_tournament_id = 17
        room.updated_at = timezone.now()
        room.state = {'presence': {'connections': {
            'worker-a': {'color': 'white', 'lastSeen': time()},
            'worker-b': {'color': 'black', 'lastSeen': time()},
        }}}
        with patch('game.consumers.get_room', AsyncMock(return_value=room)):
            await GameConsumer._broadcast_room_status(consumer)
        consumer.channel_layer.group_send.assert_awaited_once_with(consumer.room_group_name, {
            'type': 'room_status', 'status': 'playing', 'connected': 2,
            'connectedColors': ['black', 'white'],
            'presenceVersion': int(room.updated_at.timestamp() * 1_000_000),
        })

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
