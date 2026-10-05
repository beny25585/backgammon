import uuid
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from django.apps import apps
from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.utils import timezone

from game.inactivity import ensure_inactivity_check, ensure_inactivity_watchdog
from game.models import GameRoom, GameState, Task
from game.task_runner import run_task


class RecurringTaskTests(TestCase):
    def _finalize_after_commit(self, *, rollback=False):
        from game.inactivity import _finalize_inactivity_loss
        room = GameRoom.objects.create(code='COMMIT', status='playing')
        block = {'player': 'white', 'warnedAtMs': 0, 'deadlineMs': 1000}
        game_state = GameState.objects.create(room=room, state_data={
            'phase': 'moving', 'turn': 'white', 'inactivity': block,
        })
        sender = AsyncMock()
        with patch('game.clock.active_player', return_value='white'), \
                patch('game.presence.needs_admin_adjudication', return_value=False), \
                patch('game.inactivity.time_module.time', return_value=2), \
                patch('game.formats.forfeit_win_type', return_value='single'), \
                patch('game.game_service.finalize_room', return_value=SimpleNamespace(id=uuid.uuid4())), \
                patch('game.game_service.game_ended_payload', return_value={}), \
                patch('channels.layers.get_channel_layer', return_value=SimpleNamespace(group_send=sender)):
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                with transaction.atomic():
                    result = _finalize_inactivity_loss(room, {}, game_state, block)
                    self.assertEqual(result['status'], 'forfeited')
                    sender.assert_not_awaited()
                    if rollback:
                        transaction.set_rollback(True)
            self.assertEqual(len(callbacks), 0 if rollback else 1)
            self.assertEqual(sender.await_count, 0 if rollback else 1)

    def test_inactivity_result_notification_waits_until_commit(self):
        self._finalize_after_commit()

    def test_rolled_back_inactivity_result_is_not_broadcast(self):
        self._finalize_after_commit(rollback=True)

    def test_monitor_fetches_room_states_without_one_query_per_room(self):
        from game.inactivity import check_inactivity_watchdog
        for index in range(5):
            room = GameRoom.objects.create(code=f'B{index:05}', status='playing')
            GameState.objects.create(room=room, state_data={'phase': 'opening_roll'})
            ensure_inactivity_check(room.pk)
        with self.assertNumQueries(3):
            check_inactivity_watchdog()

    def test_database_prevents_two_task_identities(self):
        ensure_inactivity_check('room')
        with self.assertRaises(IntegrityError), transaction.atomic():
            Task.objects.create(key='inactivity:room', name='unused')

    def test_running_watchdog_is_rescheduled_in_its_own_row(self):
        ensure_inactivity_watchdog()
        task = Task.objects.get(key='inactivity-watchdog')
        Task.objects.filter(pk=task.pk).update(run_at=timezone.now())
        self.assertTrue(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertGreater(task.run_at, timezone.now())
        self.assertEqual(Task.objects.filter(name=task.name).count(), 1)
        self.assertIsNone(task.lease_token)

    def test_external_wakeup_is_kept_when_running_check_returns_without_rescheduling(self):
        from game.scheduling import current_schedule, schedule_unique
        task = Task.objects.create(key='wake-test', name='fake.call', run_at=timezone.now())
        requested_at = timezone.now()

        def handler():
            # Simulate a caller outside the executing worker's ContextVar.
            token = current_schedule.set(None)
            try:
                schedule_unique(task.key, task.name, [], requested_at)
            finally:
                current_schedule.reset(token)
            return {'status': 'closed'}

        with patch('game.task_runner.import_module', return_value=SimpleNamespace(call=handler)):
            self.assertTrue(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.run_at, requested_at)
        self.assertIsNone(task.requested_run_at)
        self.assertEqual(Task.objects.filter(key='wake-test').count(), 1)

    def test_failure_retries_same_row_without_creating_a_successor(self):
        ensure_inactivity_watchdog()
        task = Task.objects.get(key='inactivity-watchdog')
        Task.objects.filter(pk=task.pk).update(run_at=timezone.now())
        with patch('game.task_runner.import_module', side_effect=RuntimeError('temporary failure')):
            self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertIn('temporary failure', task.last_error)
        self.assertEqual(Task.objects.filter(name=task.name).count(), 1)

    def test_replaced_lease_cannot_complete_new_owner(self):
        task = Task.objects.create(name='fake.call')
        replacement = uuid.uuid4()
        def handler():
            Task.objects.filter(pk=task.pk).update(lease_token=replacement)
            return {'ok': True}
        with patch('game.task_runner.import_module', return_value=SimpleNamespace(call=handler)):
            self.assertFalse(run_task(task.pk))
        task.refresh_from_db()
        self.assertEqual(task.status, 'running')
        self.assertEqual(task.lease_token, replacement)

    def test_failed_scan_does_not_reschedule_from_finally(self):
        ensure_inactivity_watchdog()
        task = Task.objects.get(key='inactivity-watchdog')
        Task.objects.filter(pk=task.pk).update(run_at=timezone.now())
        with patch('game.models.GameRoom.objects.filter', side_effect=RuntimeError('scan failed')):
            self.assertFalse(run_task(task.pk))
        self.assertEqual(Task.objects.filter(name=task.name).count(), 1)

    def test_watchdog_repairs_room_and_keeps_one_check_across_ticks(self):
        room = GameRoom.objects.create(code='REPAIR', status='playing')
        GameState.objects.create(room=room, state_data={'phase': 'moving', 'inactivity': {
            'player': 'white', 'lastActionAtMs': int(timezone.now().timestamp() * 1000),
        }})
        ensure_inactivity_watchdog()
        dog = Task.objects.get(key='inactivity-watchdog')
        for _ in range(2):
            Task.objects.filter(pk=dog.pk).update(run_at=timezone.now())
            self.assertTrue(run_task(dog.pk))
        self.assertEqual(Task.objects.filter(key=f'inactivity:{room.pk}').count(), 1)

    def test_migration_retires_only_duplicate_checks_and_preserves_result_work(self):
        for _ in range(2):
            Task.objects.create(name='game.inactivity.check_room_inactivity', args=['same'])
        result = Task.objects.create(name='game.link.outbox.deliver_result', args=['same'])
        import_module('game.migrations.0020_task_identity_lease').consolidate_checks(
            apps, SimpleNamespace(connection=connection))
        self.assertEqual(Task.objects.filter(key='inactivity:same', status='pending').count(), 1)
        self.assertEqual(Task.objects.filter(name='game.inactivity.check_room_inactivity', status='done').count(), 1)
        result.refresh_from_db()
        self.assertEqual(result.status, 'pending')
