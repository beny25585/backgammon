from datetime import timedelta
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from game.models import Task
from game.task_runner import RESULT_TASK, run_task


class DeliveryRecoveryTests(TestCase):
    def test_worker_recovers_expired_lease_and_old_failed_result(self):
        for status in ['running', 'failed']:
            task = Task.objects.create(name=RESULT_TASK, kwargs={'link_id': 1}, status=status, attempts=8)
            Task.objects.filter(pk=task.pk).update(updated_at=timezone.now() - timedelta(minutes=3))
            with patch(RESULT_TASK, return_value={'status': 'delivered'}) as deliver:
                call_command('run_tasks')
            task.refresh_from_db()
            self.assertEqual(task.status, 'done')
            self.assertEqual(task.attempts, 9)
            deliver.assert_called_once()

    def test_fresh_lease_cannot_be_claimed_twice(self):
        task = Task.objects.create(name=RESULT_TASK, status='running')
        with patch(RESULT_TASK) as deliver:
            self.assertFalse(run_task(task.pk))
        deliver.assert_not_called()

    def test_long_outage_has_bounded_backoff_and_eventually_delivers(self):
        task = Task.objects.create(name=RESULT_TASK, attempts=500)
        with patch(RESULT_TASK, side_effect=OSError('unavailable')):
            run_task(task.pk)
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertLessEqual((task.run_at - timezone.now()).total_seconds(), 1800)
        Task.objects.filter(pk=task.pk).update(run_at=timezone.now())
        with patch(RESULT_TASK, return_value={'status': 'already_recorded'}):
            run_task(task.pk)
        task.refresh_from_db()
        self.assertEqual(task.status, 'done')
