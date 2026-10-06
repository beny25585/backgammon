import logging

import httpx
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .payload import (
    AnalysisPayloadError,
    build_match_analysis_payload,
    validate_match_history,
)
from ..models import GameEvent, GameRoom, Match, Task
from ..scheduling import current_schedule
from ..task_runner import NonRetryableTaskError


logger = logging.getLogger(__name__)


ANALYSIS_PATH = "/api/v1/internal/matches/"
DELIVERY_TIMEOUT_SECONDS = 15.0

TASK_NAME = "game.analysis.outbox.deliver_analysis"


def enqueue_match_analysis(match):
    """
    Queue a completed Match for delivery to the Analysis Service.

    Must be called inside the same transaction that creates the Match.
    If that transaction rolls back, this Task rolls back too.
    """

    task, _ = Task.objects.get_or_create(
        key=f'analysis:{match.pk}',
        defaults={'name': TASK_NAME, 'kwargs': {'match_id': str(match.pk)},
                  'run_at': timezone.now(), 'max_attempts': 10},
    )

    logger.info(
        "analysis queued: match=%s task=%s",
        match.id,
        task.id,
    )

    return task


def _frozen_payload(match_id):
    """Save once before HTTP; retries use the claimed task's existing payload.

    Lock order is room -> task, matching scoring. The task lease fences freezing
    too: an old worker cannot replace a payload after another worker took over.
    """
    schedule = current_schedule.get()
    if schedule is not None:
        task = schedule['task']
        if str(task.kwargs.get('match_id')) != str(match_id):
            raise NonRetryableTaskError('Analysis task does not belong to this match')
    else:
        task, _ = Task.objects.get_or_create(
            key=f'analysis:{match_id}',
            defaults={'name': TASK_NAME, 'kwargs': {'match_id': str(match_id)}, 'run_at': timezone.now()},
        )
    if task.delivery_payload is not None:
        if not isinstance(task.delivery_payload, dict) or task.delivery_payload.get('match_id') != str(match_id):
            raise NonRetryableTaskError('Frozen analysis payload does not belong to this match')
        return task.delivery_payload

    try:
        with transaction.atomic():
            match = Match.objects.select_related('white_player__user', 'black_player__user').get(pk=match_id)
            if match.room_id is None:
                raise AnalysisPayloadError('Match has no room.')
            room = GameRoom.objects.select_for_update().get(pk=match.room_id)
            match.room = room
            if room.status != 'completed':
                raise AnalysisPayloadError('Match room has not completed.')
            if match.history_sequence is None:
                validate_match_history(match, ())
            if room.history_sequence != match.history_sequence:
                raise AnalysisPayloadError('Room history changed after the match was sealed.')
            tasks = schedule['lease'] if schedule else Task.objects.filter(pk=task.pk)
            owned = tasks.select_for_update().only('delivery_payload').first()
            if owned is None:
                raise RuntimeError('Analysis task lease was replaced before payload preparation')
            payload = owned.delivery_payload
            if payload is None:
                events = list(GameEvent.objects.filter(room=room).select_related('player').order_by('sequence'))
                validate_match_history(match, events)
                payload = build_match_analysis_payload(match, events=events)
                if not tasks.update(delivery_payload=payload):
                    raise RuntimeError('Analysis task lease was replaced before payload freezing')
            if not isinstance(payload, dict) or payload.get('match_id') != str(match_id):
                raise AnalysisPayloadError('Frozen analysis payload does not belong to this match.')
            task.delivery_payload = payload
            return payload
    except (Match.DoesNotExist, GameRoom.DoesNotExist) as exc:
        raise NonRetryableTaskError(f'match {match_id} or its room does not exist') from exc
    except (AnalysisPayloadError, KeyError, TypeError, ValueError) as exc:
        raise NonRetryableTaskError(f'cannot prepare analysis for match {match_id}: {exc}') from exc


def deliver_analysis(match_id):
    """
    Build the immutable payload and POST it to the Analysis Service.

    The Analysis Service is idempotent by match_id, so retrying the
    exact same completed match is safe.
    """

    payload = _frozen_payload(match_id)

    base_url = (
        getattr(
            settings,
            "ANALYSIS_SERVICE_URL",
            "",
        )
        or ""
    ).rstrip("/")

    if not base_url:
        raise NonRetryableTaskError(
            "ANALYSIS_SERVICE_URL is not configured"
        )

    url = f"{base_url}{ANALYSIS_PATH}"

    response = httpx.post(
        url,
        json=payload,
        timeout=DELIVERY_TIMEOUT_SECONDS,
    )

    if not (
        200 <= response.status_code < 300
    ):
        # Temporary failures should be retried.
        if (
            response.status_code >= 500
            or response.status_code
            in (408, 429)
        ):
            raise RuntimeError(
                "Analysis Service temporary failure: "
                f"HTTP {response.status_code}"
            )

        # 409 means this match_id was already received
        # with a different payload. Retrying cannot fix it.
        raise NonRetryableTaskError(
            "Analysis Service rejected match "
            f"{match_id}: "
            f"HTTP {response.status_code}"
        )

    try:
        response_data = response.json()
    except ValueError:
        response_data = None
    if not isinstance(response_data, dict) or (
            response_data.get('status') not in ('accepted', 'already_exists')
            or response_data.get('match_id') != str(match_id)
            or not response_data.get('analysis_id')):
        raise RuntimeError('Analysis Service did not acknowledge this match; retry the frozen payload')

    logger.info(
        "analysis delivered: match=%s "
        "http=%s status=%s analysis_id=%s",
        match_id,
        response.status_code,
        response_data.get("status"),
        response_data.get("analysis_id"),
    )

    return {
        "status": response_data.get(
            "status",
            "delivered",
        ),
        "match_id": str(match_id),
        "analysis_id": response_data.get(
            "analysis_id"
        ),
    }


def try_deliver_analysis_now(task_id):
    """Compatibility for explicit callers; scoring never calls HTTP on commit."""

    from ..task_runner import run_task

    try:
        run_task(task_id)
    except Exception:
        logger.exception(
            "immediate analysis delivery interrupted; "
            "worker will retry task=%s",
            task_id,
        )
