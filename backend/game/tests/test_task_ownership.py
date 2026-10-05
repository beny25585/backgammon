import uuid
from threading import Barrier, Event, Thread
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import TransactionTestCase
from django.utils import timezone

from game.models import GameRoom, Task
from game.scheduling import check_ownership, schedule_unique
from game.task_runner import run_task


@skipUnless(connection.vendor == 'postgresql', 'Requires real PostgreSQL task concurrency')
class ConcurrentGameTaskTests(TransactionTestCase):
    def worker(self, operation, results, errors):
        database = connections['default']
        try:
            with database.cursor() as cursor:
                cursor.execute("SET lock_timeout TO '5s'")
            results.append(operation())
        except Exception as error:
            errors.append(error)
        finally:
            database.close()

    def test_scheduling_same_room_concurrently_creates_one_identity(self):
        gate = Barrier(2)
        results, errors = [], []

        def schedule():
            gate.wait(timeout=5)
            return schedule_unique('inactivity:same-room', 'game.inactivity.check_room_inactivity',
                                   ['same-room'], timezone.now())

        threads = [Thread(target=self.worker, args=(schedule, results, errors), daemon=True) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(errors, [])
        self.assertCountEqual(results, [True, False])
        self.assertEqual(Task.objects.filter(key='inactivity:same-room').count(), 1)

    def test_second_worker_does_not_execute_running_task(self):
        task = Task.objects.create(key='one-owner', name='fake.handler', run_at=timezone.now())
        entered, release = Event(), Event()
        results, errors = [], []

        def handler():
            entered.set()
            if not release.wait(timeout=8):
                raise RuntimeError('Task test did not release handler')
            return {}

        worker = Thread(target=self.worker, args=(lambda: run_task(task.pk), results, errors), daemon=True)
        with patch('game.task_runner.import_module', return_value=SimpleNamespace(handler=handler)):
            try:
                worker.start()
                self.assertTrue(entered.wait(timeout=5))
                self.assertFalse(run_task(task.pk))
            finally:
                release.set()
                worker.join(timeout=10)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(results, [True])

    def test_external_wakeup_survives_another_workers_completion(self):
        task = Task.objects.create(key='wake-owner', name='fake.handler', run_at=timezone.now())
        entered, release = Event(), Event()
        results, errors = [], []

        def handler():
            entered.set()
            if not release.wait(timeout=8):
                raise RuntimeError('Wakeup test did not release handler')
            return {}

        worker = Thread(target=self.worker, args=(lambda: run_task(task.pk), results, errors), daemon=True)
        with patch('game.task_runner.import_module', return_value=SimpleNamespace(handler=handler)):
            try:
                worker.start()
                self.assertTrue(entered.wait(timeout=5))
                requested_at = timezone.now()
                self.assertFalse(schedule_unique(task.key, task.name, [], requested_at))
            finally:
                release.set()
                worker.join(timeout=10)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(results, [True])
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertEqual(task.run_at, requested_at)
        self.assertIsNone(task.requested_run_at)

    def test_room_mutation_is_fenced_after_waiting_for_its_lock(self):
        room = GameRoom.objects.create(code='FENCED', status='playing')
        task = Task.objects.create(key='room-fence', name='fake.handler', run_at=timezone.now())
        replacement = uuid.uuid4()
        waiting = Event()
        results, errors = [], []

        def handler():
            waiting.set()
            with transaction.atomic():
                locked = GameRoom.objects.select_for_update().get(pk=room.pk)
                check_ownership(lock=True)
                locked.status = 'cancelled'
                locked.save(update_fields=['status'])
            return {}

        worker = Thread(target=self.worker, args=(lambda: run_task(task.pk), results, errors), daemon=True)
        with patch('game.task_runner.import_module', return_value=SimpleNamespace(handler=handler)):
            try:
                with transaction.atomic():
                    GameRoom.objects.select_for_update().get(pk=room.pk)
                    worker.start()
                    self.assertTrue(waiting.wait(timeout=5))
                    Task.objects.filter(pk=task.pk).update(lease_token=replacement)
            finally:
                if worker.ident is not None:
                    worker.join(timeout=10)
        self.assertFalse(worker.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(results, [False])
        room.refresh_from_db()
        task.refresh_from_db()
        self.assertEqual(room.status, 'playing')
        self.assertEqual(task.lease_token, replacement)
