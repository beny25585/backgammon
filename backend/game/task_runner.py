"""Leased execution shared by immediate delivery and the scheduled worker."""
import logging
from datetime import timedelta
from importlib import import_module
import time
import uuid
import random

from django.db.models import F, Q
from django.db import transaction
from django.utils import timezone

from .models import Task
from .scheduling import current_schedule

logger = logging.getLogger(__name__)
RESULT_TASK = 'game.link.outbox.deliver_result'
DURABLE_DELIVERY_TASKS = (RESULT_TASK, 'game.link.live.deliver_status_event')
LEASE_SECONDS = 120

_channel_backend_logged = False


def log_channel_layer_backend_once():
    global _channel_backend_logged
    if _channel_backend_logged:
        return
    _channel_backend_logged = True
    try:
        from django.conf import settings

        backend = (settings.CHANNEL_LAYERS.get('default', {}).get('BACKEND')
                   if hasattr(settings, 'CHANNEL_LAYERS') else None)
    except Exception:
        backend = None
    logger.info('CHANNEL_LAYER_BACKEND backend=%s', backend)


class NonRetryableTaskError(RuntimeError):
    """The saved request needs operator attention before it can be sent again."""


def runnable(now):
    return (
        Q(status='pending') & (Q(run_at__lte=now) | Q(run_at__isnull=True))
        | Q(status='running', updated_at__lte=now - timedelta(seconds=LEASE_SECONDS))
        | Q(status='failed', name__in=DURABLE_DELIVERY_TASKS)
    )


def run_task(task_id):
    log_channel_layer_backend_once()

    claim_started = time.perf_counter()
    now = timezone.now()
    lease_token = uuid.uuid4()

    # Compare-and-set also works on SQLite. Only one worker can claim this lease.
    claimed = Task.objects.filter(
        pk=task_id,
    ).filter(
        runnable(now),
    ).update(
        status='running',
        attempts=F('attempts') + 1,
        updated_at=now,
        lease_token=lease_token,
        requested_run_at=None,
    )

    claim_ms = int((time.perf_counter() - claim_started) * 1000)

    if not claimed:
        logger.info(
            'TASK_SKIPPED task=%s claim_ms=%s',
            task_id,
            claim_ms,
        )
        return False

    task = Task.objects.filter(pk=task_id, lease_token=lease_token, status='running').first()
    if task is None:
        return False

    queue_delay_ms = None
    if task.run_at is not None:
        queue_delay_ms = max(
            0,
            int((now - task.run_at).total_seconds() * 1000),
        )

    logger.info(
        'TASK_START task=%s name=%s attempts=%s '
        'queue_delay_ms=%s claim_ms=%s args=%s',
        task.pk,
        task.name,
        task.attempts,
        queue_delay_ms,
        claim_ms,
        task.args,
    )

    lease = Task.objects.filter(
        pk=task_id,
        status='running',
        attempts=task.attempts,
        lease_token=lease_token,
    )

    execution_started = time.perf_counter()
    schedule = {'key': task.key, 'run_at': None, 'owns': lease.exists, 'lease': lease,
                'heartbeat': lambda: bool(lease.update(updated_at=timezone.now())),
                'renew_at': time.monotonic() + 30}
    schedule_token = current_schedule.set(schedule)

    try:
        module, _, name = task.name.rpartition('.')

        result = getattr(
            import_module(module),
            name,
        )(
            *task.args,
            **task.kwargs,
        )

    except Exception as exc:
        execution_ms = int(
            (time.perf_counter() - execution_started) * 1000
        )

        blocked = isinstance(exc, NonRetryableTaskError)
        retry = (
            not blocked
            and (
                task.name in DURABLE_DELIVERY_TASKS or task.key is not None
                or task.attempts < task.max_attempts
            )
        )

        update_started = time.perf_counter()

        lease.update(
            status=(
                'blocked'
                if blocked
                else ('pending' if retry else 'failed')
            ),
            run_at=timezone.now()
            + timedelta(
                seconds=min(
                    30 * 2 ** min(task.attempts - 1, 6),
                    1800,
                ) + random.uniform(0, 5)
            ),
            last_error=str(exc)[:2000],
            updated_at=timezone.now(),
            lease_token=None,
        )

        update_ms = int(
            (time.perf_counter() - update_started) * 1000
        )

        logger.error(
            'TASK_FAILED task=%s name=%s attempts=%s '
            'queue_delay_ms=%s execution_ms=%s update_ms=%s '
            'retry=%s blocked=%s error=%s',
            task.pk,
            task.name,
            task.attempts,
            queue_delay_ms,
            execution_ms,
            update_ms,
            retry,
            blocked,
            exc,
            exc_info=True,
        )

        return False

    finally:
        current_schedule.reset(schedule_token)

    execution_ms = int(
        (time.perf_counter() - execution_started) * 1000
    )

    update_started = time.perf_counter()

    # Merge external wakeups under the queue row lock. No room locks or remote
    # work here; a request either precedes completion or reactivates done work.
    with transaction.atomic():
        latest = lease.select_for_update().only('pk', 'requested_run_at').first()
        completed = False
        if latest is not None:
            next_runs = [value for value in (schedule['run_at'], latest.requested_run_at) if value is not None]
            next_run = min(next_runs) if next_runs else None
            completed = lease.update(
                kwargs=schedule.get('kwargs', task.kwargs),
                status='pending' if next_run is not None else 'done',
                run_at=next_run if next_run is not None else task.run_at,
                result=result if result is not None else {},
                last_error=None,
                updated_at=timezone.now(),
                lease_token=None,
                requested_run_at=None,
                attempts=0 if next_run is not None else task.attempts,
            )

    update_ms = int(
        (time.perf_counter() - update_started) * 1000
    )

    total_ms = claim_ms + execution_ms + update_ms

    if not completed:
        logger.warning('event=task_lease_lost task=%s name=%s phase=completion', task.pk, task.name)
        return False

    logger.info(
        'TASK_DONE task=%s name=%s attempts=%s '
        'queue_delay_ms=%s execution_ms=%s '
        'claim_ms=%s update_ms=%s total_ms=%s result=%s',
        task.pk,
        task.name,
        task.attempts,
        queue_delay_ms,
        execution_ms,
        claim_ms,
        update_ms,
        total_ms,
        result,
    )

    return bool(completed)
