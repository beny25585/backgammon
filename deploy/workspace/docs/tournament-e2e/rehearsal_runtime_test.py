"""Task progress checks: no Docker, application setup or database access."""
import copy
import unittest

from rehearsal_runtime import RECURRING, progress


class RuntimeProgressTests(unittest.TestCase):
    def snapshots(self):
        before = {'kind': 'tournaments', 'session_id': 'a' * 32,
                  'observed_at': '2026-10-06T13:50:00+00:00',
                  'tasks': [{'name': name, 'status': 'pending', 'has_error': False,
                             'last_finished_at': '2026-10-06T13:49:00+00:00'} for name in RECURRING],
                  'admin_commands': {'error_tasks': 0, 'completed_tasks': 0, 'pending_without_task': 0},
                  'push': {'last_seen_at': '2026-10-06T13:49:58+00:00',
                           'expected_by': '2026-10-06T13:50:15+00:00'}}
        after = copy.deepcopy(before)
        after['observed_at'] = '2026-10-06T13:51:10+00:00'
        for row in after['tasks']:
            row['last_finished_at'] = '2026-10-06T13:51:00+00:00'
        after['push'] = {'last_seen_at': '2026-10-06T13:51:08+00:00',
                         'expected_by': '2026-10-06T13:51:23+00:00'}
        return before, after

    def test_pending_recurring_tasks_are_healthy_when_successes_advance(self):
        before, after = self.snapshots()
        result = progress(before, after, push_required=True)
        self.assertTrue(result['passed'])
        self.assertEqual(result['issues'], [])
        self.assertFalse(result['checks']['admin_commands']['business_command_triggered'])

    def test_a_stopped_recurring_job_is_not_hidden_by_other_progress(self):
        before, after = self.snapshots()
        after['tasks'][0]['last_finished_at'] = before['tasks'][0]['last_finished_at']
        self.assertFalse(progress(before, after)['passed'])

    def test_real_errors_and_unqueued_admin_commands_fail(self):
        before, after = self.snapshots()
        after['tasks'][0]['has_error'] = True
        self.assertFalse(progress(before, after)['passed'])
        before, after = self.snapshots()
        after['admin_commands']['pending_without_task'] = 1
        self.assertFalse(progress(before, after)['passed'])

    def test_push_requires_a_fresh_advancing_heartbeat(self):
        before, after = self.snapshots()
        after['push'] = before['push']
        self.assertFalse(progress(before, after, push_required=True)['passed'])

    def test_missing_push_heartbeat_and_duplicate_jobs_cannot_pass(self):
        before, after = self.snapshots()
        after['push']['last_seen_at'] = None
        self.assertFalse(progress(before, after, push_required=True)['passed'])
        before, after = self.snapshots()
        after['tasks'].append(copy.deepcopy(after['tasks'][0]))
        self.assertFalse(progress(before, after)['passed'])

    def test_different_sessions_cannot_be_compared(self):
        before, after = self.snapshots()
        after['session_id'] = 'b' * 32
        with self.assertRaises(ValueError):
            progress(before, after)

    def test_game_watchdog_must_complete_and_reschedule(self):
        before = {'kind': 'game', 'session_id': 'a' * 32, 'tasks': [{
            'name': 'game.inactivity.check_inactivity_watchdog', 'status': 'pending',
            'has_error': False, 'run_at': '2026-10-06T13:50:00+00:00'}]}
        after = copy.deepcopy(before)
        after['tasks'][0]['run_at'] = '2026-10-06T13:51:00+00:00'
        self.assertTrue(progress(before, after)['passed'])


if __name__ == '__main__':
    unittest.main()
