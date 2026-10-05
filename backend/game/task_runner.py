"""Leased execution shared by immediate delivery and the scheduled worker."""
import logging
from datetime import timedelta
from importlib import import_module
import time

from django.db.models import F, Q
from django.utils import timezone

from .models import Task

logger = logging.getLogger(__name__)
RESULT_TASK = 'game.link.outbox.deliver_result'
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
        | Q(status='failed', name=RESULT_TASK)
    )


def run_task(task_id):
    log_channel_layer_backend_once()

    claim_started = time.perf_counter()
    now = timezone.now()

    # Compare-and-set also works on SQLite. Only one worker can claim this lease.
    claimed = Task.objects.filter(
        pk=task_id,
    ).filter(
        runnable(now),
    ).update(
        status='running',
        attempts=F('attempts') + 1,
        updated_at=now,
    )

    claim_ms = int((time.perf_counter() - claim_started) * 1000)

    if not claimed:
        logger.info(
            'TASK_SKIPPED task=%s claim_ms=%s',
            task_id,
            claim_ms,
        )
        return False

    task = Task.objects.get(pk=task_id)

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
    )

    execution_started = time.perf_counter()

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
                task.name == RESULT_TASK
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
                )
            ),
            last_error=str(exc)[:2000],
            updated_at=timezone.now(),
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

    execution_ms = int(
        (time.perf_counter() - execution_started) * 1000
    )

    update_started = time.perf_counter()

    lease.update(
        status='done',
        result=result if result is not None else {},
        last_error=None,
        updated_at=timezone.now(),
    )

    update_ms = int(
        (time.perf_counter() - update_started) * 1000
    )

    total_ms = claim_ms + execution_ms + update_ms

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

    return True
