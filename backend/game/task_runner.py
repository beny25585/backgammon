"""Leased execution shared by immediate delivery and the scheduled worker."""
import logging
from datetime import timedelta
from importlib import import_module

from django.db.models import F, Q
from django.utils import timezone

from .models import Task

logger = logging.getLogger(__name__)
RESULT_TASK = 'game.link.outbox.deliver_result'
LEASE_SECONDS = 120


def runnable(now):
    return (
        Q(status='pending') & (Q(run_at__lte=now) | Q(run_at__isnull=True))
        | Q(status='running', updated_at__lte=now - timedelta(seconds=LEASE_SECONDS))
        | Q(status='failed', name=RESULT_TASK)
    )


def run_task(task_id):
    now = timezone.now()
    # Compare-and-set also works on SQLite. Only one worker can claim this lease.
    if not Task.objects.filter(pk=task_id).filter(runnable(now)).update(
        status='running', attempts=F('attempts') + 1, updated_at=now,
    ):
        return False
    task = Task.objects.get(pk=task_id)
    lease = Task.objects.filter(pk=task_id, status='running', attempts=task.attempts)
    try:
        module, _, name = task.name.rpartition('.')
        result = getattr(import_module(module), name)(*task.args, **task.kwargs)
    except Exception as exc:
        retry = task.name == RESULT_TASK or task.attempts < task.max_attempts
        lease.update(
            status='pending' if retry else 'failed',
            run_at=timezone.now() + timedelta(seconds=min(30 * 2 ** min(task.attempts - 1, 6), 1800)),
            last_error=str(exc)[:2000], updated_at=timezone.now(),
        )
        logger.error('task_delivery_failed task=%s name=%s attempts=%s retry=%s error=%s',
                     task.pk, task.name, task.attempts, retry, exc)
        return False
    lease.update(status='done', result=result if result is not None else {},
                 last_error=None, updated_at=timezone.now())
    return True
