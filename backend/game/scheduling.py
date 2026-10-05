"""Stable queue identities and one rescheduling path for recurring checks."""
from contextvars import ContextVar
from time import monotonic

from django.utils import timezone
from django.db import transaction

current_schedule = ContextVar('game_task_schedule', default=None)


def check_ownership(*, lock=False):
    current = current_schedule.get()
    if current is None:
        return
    if lock:
        from django.db import connection
        if not connection.in_atomic_block:
            raise RuntimeError('Task ownership fencing requires an atomic transaction')
        # Acquire AFTER the room lock, like room -> queued work elsewhere.
        # The claim is a separate autocommit UPDATE and holds no room locks.
        owned = current['lease'].select_for_update().only('pk').first() is not None
    else:
        owned = current['owns']()
    if not owned:
        raise RuntimeError('Recurring task lease was replaced')
    if monotonic() >= current['renew_at']:
        if not current['heartbeat']():
            raise RuntimeError('Recurring task lease was replaced')
        current['renew_at'] = monotonic() + 30


def schedule_unique(key, name, args, run_at):
    from .models import Task

    current = current_schedule.get()
    if current is not None and current['key'] == key:
        current['run_at'] = run_at
        return False
    task, created = Task.objects.get_or_create(
        key=key, defaults={'name': name, 'args': args, 'run_at': run_at},
    )
    if not created:
        if task.status == 'pending' and (task.attempts > 0 or task.run_at is None or task.run_at <= run_at):
            return False
        # Completion and a new claim can happen after the first SELECT. Lock
        # and re-read only when a wakeup/earlier deadline needs to be written.
        # This is queue metadata only; no business locks are acquired here.
        with transaction.atomic():
            task = Task.objects.select_for_update().get(pk=task.pk)
            if task.status == 'running':
                if task.requested_run_at is None or task.requested_run_at > run_at:
                    Task.objects.filter(pk=task.pk).update(requested_run_at=run_at)
            elif task.status == 'done':
                Task.objects.filter(pk=task.pk).update(
                    status='pending', run_at=run_at, updated_at=timezone.now(), last_error=None, attempts=0,
                )
                created = True
            elif task.status == 'pending' and task.attempts == 0 and task.run_at is not None and task.run_at > run_at:
                Task.objects.filter(pk=task.pk).update(run_at=run_at)
    return created
