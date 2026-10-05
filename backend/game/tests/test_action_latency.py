import json
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.test import SimpleTestCase, TestCase

from game.consumers import GameConsumer, get_received_context
from game.db_timing import measured_database_sync_to_async
from game.engine import BackgammonEngine
from game.inactivity import INACTIVITY_TASK, ensure_inactivity_check
from game.models import GameRoom, GameState, Task


class ReceivedContextTests(TestCase):
    def setUp(self):
        self.room = GameRoom.objects.create(code='CTX001', status='playing')

    def load_context(self):
        # Exercise the synchronous ORM operation without executor timing noise.
        return get_received_context.__wrapped__(self.room.id, include_state=True)

    def test_room_and_state_are_loaded_without_a_separate_state_query(self):
        state = GameState.objects.create(room=self.room, state_data={'version': 4})
        with self.assertNumQueries(2):
            room, paused, loaded_state = self.load_context()
        self.assertEqual(room.pk, self.room.pk)
        self.assertFalse(paused)
        self.assertEqual(loaded_state.pk, state.pk)
        self.assertEqual(loaded_state.state_data['version'], 4)

    def test_next_message_observes_changed_state_and_organizer_pause(self):
        GameState.objects.create(room=self.room, state_data={'version': 4})
        self.load_context()
        GameState.objects.filter(room=self.room).update(state_data={'version': 5})
        self.room.state = {'presence': {'needsAdminAdjudication': True}}
        self.room.save(update_fields=['state'])
        with self.assertNumQueries(2):
            room, paused, loaded_state = self.load_context()
        self.assertTrue(paused)
        self.assertIsNone(loaded_state)
        self.assertEqual(room.gamestate.state_data['version'], 5)

    def test_missing_legacy_state_is_not_created_during_context_loading(self):
        with self.assertNumQueries(2):
            room, paused, loaded_state = self.load_context()
        self.assertEqual(room.pk, self.room.pk)
        self.assertFalse(paused)
        self.assertIsNone(loaded_state)
        self.assertFalse(GameState.objects.filter(room=self.room).exists())


class IntentContextTests(SimpleTestCase):
    def setUp(self):
        self.consumer = GameConsumer()
        self.consumer.room_id = str(uuid.uuid4())
        self.consumer.player_color = 'white'
        self.consumer.send = AsyncMock()
        self.room = SimpleNamespace(id=self.consumer.room_id)
        state = BackgammonEngine.get_initial_state()
        state.update(phase='moving', turn='white', dice=[3, 5], remaining=[3, 5])
        self.state = SimpleNamespace(state_data=state)
        self.intent = {'type': 'state_update', 'payload': {'action': 'move', 'from': 12, 'to': 9}}

    async def test_received_move_reaches_persistence_without_reloading_context(self):
        with patch('game.consumers.get_received_context',
                   AsyncMock(return_value=(self.room, False, self.state))) as context, \
                patch('game.consumers.get_room', AsyncMock()) as room_lookup, \
                patch('game.consumers.get_game_state', AsyncMock()) as state_lookup, \
                patch('game.consumers.apply_server_game_action', AsyncMock()) as persist:
            await self.consumer.receive(json.dumps(self.intent))
        context.assert_awaited_once_with(self.consumer.room_id, include_state=True)
        room_lookup.assert_not_awaited()
        state_lookup.assert_not_awaited()
        persist.assert_awaited_once()
        self.assertEqual(persist.call_args.kwargs['new_state']['remaining'], [5])
        self.consumer.send.assert_not_awaited()

    async def test_organizer_pause_still_blocks_gameplay(self):
        self.consumer._handle_intent = AsyncMock()
        with patch('game.consumers.get_received_context',
                   AsyncMock(return_value=(self.room, True, None))):
            await self.consumer.receive(json.dumps(self.intent))
        self.consumer._handle_intent.assert_not_awaited()
        self.assertEqual(json.loads(self.consumer.send.call_args.args[0])['type'], 'admin_review_required')

    async def test_explicit_leave_remains_available_during_organizer_pause(self):
        self.consumer._handle_leave = AsyncMock()
        with patch('game.consumers.get_received_context',
                   AsyncMock(return_value=(self.room, True, None))) as context:
            await self.consumer.receive(json.dumps({'type': 'leave'}))
        context.assert_awaited_once_with(self.consumer.room_id, include_state=False)
        self.consumer._handle_leave.assert_awaited_once()

    async def test_missing_room_is_rejected_without_another_lookup(self):
        with patch('game.consumers.get_received_context',
                   AsyncMock(return_value=(None, False, None))), \
                patch('game.consumers.get_room', AsyncMock()) as room_lookup:
            await self.consumer.receive(json.dumps(self.intent))
        room_lookup.assert_not_awaited()
        self.assertEqual(json.loads(self.consumer.send.call_args.args[0])['message'], 'Room not found')

    async def test_direct_bot_dispatch_still_loads_fresh_room_and_state(self):
        with patch('game.consumers.get_room', AsyncMock(return_value=self.room)) as room_lookup, \
                patch('game.consumers.get_game_state', AsyncMock(return_value=self.state)) as state_lookup, \
                patch('game.consumers.apply_server_game_action', AsyncMock()) as persist:
            await self.consumer._handle_intent(self.intent)
        room_lookup.assert_awaited_once_with(self.consumer.room_id)
        state_lookup.assert_awaited_once_with(self.room)
        persist.assert_awaited_once()


class ClockSchedulingTests(SimpleTestCase):
    async def test_expired_action_reserve_is_scored_even_after_engine_changes_turn(self):
        consumer = GameConsumer()
        consumer.room_id = 'room'
        consumer._finalize_and_broadcast = AsyncMock()
        room = SimpleNamespace(status='playing', time_control='normal', target_points=1)
        state = SimpleNamespace(state_data={'phase': 'rolling', 'turn': 'black',
            'clock': {'white': 0, 'black': 60000}, 'turnStartedAt': 100000})
        with patch('game.consumers.get_room', AsyncMock(return_value=room)), \
                patch('game.consumers.get_game_state', AsyncMock(return_value=state)), \
                patch('game.consumers.needs_admin_adjudication', return_value=False), \
                patch('game.consumers.time_module.time', return_value=101):
            await consumer._forfeit_on_time('black', 'white')
        consumer._finalize_and_broadcast.assert_awaited_once()
        self.assertEqual(consumer._finalize_and_broadcast.call_args.args[3], 'time')

    async def test_deferred_forfeit_does_not_apply_after_deadline_is_extended(self):
        consumer = GameConsumer()
        consumer.room_id = 'room'
        consumer._finalize_and_broadcast = AsyncMock()
        room = SimpleNamespace(status='playing', time_control='normal', target_points=1)
        state = SimpleNamespace(state_data={'phase': 'moving', 'turn': 'white',
            'clock': {'white': 50000, 'black': 60000}, 'turnStartedAt': 100000})
        with patch('game.consumers.get_room', AsyncMock(return_value=room)), \
                patch('game.consumers.get_game_state', AsyncMock(return_value=state)), \
                patch('game.consumers.needs_admin_adjudication', return_value=False), \
                patch('game.consumers.time_module.time', return_value=101):
            await consumer._forfeit_on_time('black', 'white')
        consumer._finalize_and_broadcast.assert_not_awaited()

    async def test_action_snapshot_schedules_clock_without_database_reads(self):
        consumer = GameConsumer()
        consumer._schedule_timeout = AsyncMock()
        room = SimpleNamespace(time_control='normal', target_points=1)
        state = {'phase': 'moving', 'turn': 'white'}
        with patch('game.consumers.active_player', return_value='white'), \
                patch('game.consumers.deadline_for', return_value=12345):
            await consumer._schedule_timeout_from_snapshot(state, room)
        consumer._schedule_timeout.assert_awaited_once_with(12345, 'white')

    async def test_terminal_snapshot_does_not_arm_clock(self):
        consumer = GameConsumer()
        consumer._schedule_timeout = AsyncMock()
        with patch('game.consumers.active_player', return_value='white'):
            await consumer._schedule_timeout_from_snapshot(
                {'phase': 'game_over'}, SimpleNamespace())
        consumer._schedule_timeout.assert_not_awaited()

    async def test_old_timeout_rearms_when_persisted_deadline_is_extended(self):
        consumer = GameConsumer()
        consumer.room_id = 'room'
        consumer._schedule_timeout = AsyncMock()
        consumer._forfeit_on_time = AsyncMock()
        room = SimpleNamespace(time_control='normal', target_points=1)
        state = SimpleNamespace(state_data={'phase': 'moving', 'turn': 'white'})
        with patch('game.consumers.get_room', AsyncMock(return_value=room)), \
                patch('game.consumers.get_game_state', AsyncMock(return_value=state)), \
                patch('game.consumers.needs_admin_adjudication', return_value=False), \
                patch('game.consumers.active_player', return_value='white'), \
                patch('game.consumers.deadline_for', return_value=200000), \
                patch('game.consumers.time_module.time', return_value=100):
            await consumer._timeout_watch(99, 'white')
        consumer._forfeit_on_time.assert_not_awaited()
        consumer._schedule_timeout.assert_awaited_once_with(200000, 'white')


class DatabaseTimingTests(SimpleTestCase):
    async def test_executor_wait_is_separate_and_arguments_are_not_logged(self):
        def operation(secret):
            return secret

        def immediate_executor(function):
            async def run():
                return function()
            return run

        with patch('game.db_timing.database_sync_to_async', immediate_executor), \
                patch('game.db_timing.perf_counter', side_effect=[0, 0.6, 1.6, 2.0]), \
                self.assertLogs('game.db_timing', level='WARNING') as logs:
            result = await measured_database_sync_to_async(operation)('private-value')
        self.assertEqual(result, 'private-value')
        self.assertIn('queue_ms=600.0', logs.output[0])
        self.assertIn('execution_ms=1000.0', logs.output[0])
        self.assertNotIn('private-value', logs.output[0])


class InactivityLookupTests(TestCase):
    def test_existing_room_task_requires_only_one_query(self):
        Task.objects.create(key='inactivity:wanted', name=INACTIVITY_TASK, args=['wanted', 'legacy-extra'])
        Task.objects.create(name=INACTIVITY_TASK, args=['other'])
        with self.assertNumQueries(1):
            self.assertFalse(ensure_inactivity_check('wanted'))
        self.assertEqual(Task.objects.count(), 2)

    def test_other_rooms_task_does_not_suppress_missing_check(self):
        Task.objects.create(name=INACTIVITY_TASK, args=['other'])
        with patch('game.inactivity.ensure_inactivity_watchdog'):
            self.assertTrue(ensure_inactivity_check('wanted'))
        self.assertEqual(Task.objects.filter(name=INACTIVITY_TASK, args__0='wanted').count(), 1)
