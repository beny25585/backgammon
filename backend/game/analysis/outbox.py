import logging

import httpx
from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from .payload import (
    AnalysisPayloadError,
    build_match_analysis_payload,
)
from ..models import GameEvent, Match, Task
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

    task = Task.objects.create(
        name=TASK_NAME,
        kwargs={
            "match_id": str(match.id),
        },
        run_at=timezone.now(),
        max_attempts=10,
    )

    logger.info(
        "analysis queued: match=%s task=%s",
        match.id,
        task.id,
    )

    transaction.on_commit(
        lambda: try_deliver_analysis_now(task.pk)
    )

    return task


def _ensure_events_complete(match):
    """
    Do not send analysis until all asynchronously persisted GameEvents
    have reached the database.

    room.last_sequence is advanced before each event is persisted.
    Therefore max(GameEvent.sequence) must catch up before delivery.
    """

    room = match.room

    if room is None:
        raise NonRetryableTaskError(
            f"match {match.id} has no room"
        )

    room.refresh_from_db(
        fields=["last_sequence"]
    )

    max_event_sequence = (
        GameEvent.objects
        .filter(room=room)
        .aggregate(value=Max("sequence"))
        ["value"]
        or 0
    )

    if max_event_sequence < room.last_sequence:
        raise RuntimeError(
            "Game events are still being persisted: "
            f"match={match.id} "
            f"events={max_event_sequence} "
            f"room_sequence={room.last_sequence}"
        )


def deliver_analysis(match_id):
    """
    Build the immutable payload and POST it to the Analysis Service.

    The Analysis Service is idempotent by match_id, so retrying the
    exact same completed match is safe.
    """

    try:
        match = (
            Match.objects
            .select_related("room")
            .get(pk=match_id)
        )
    except Match.DoesNotExist as exc:
        raise NonRetryableTaskError(
            f"match {match_id} does not exist"
        ) from exc

    _ensure_events_complete(match)

    try:
        payload = build_match_analysis_payload(
            match
        )
    except AnalysisPayloadError as exc:
        raise NonRetryableTaskError(
            f"cannot build analysis payload "
            f"for match {match_id}: {exc}"
        ) from exc

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
        response_data = {}

    logger.info(
        "analysis delivered: match=%s "
        "http=%s status=%s analysis_id=%s",
        match.id,
        response.status_code,
        response_data.get("status"),
        response_data.get("analysis_id"),
    )

    return {
        "status": response_data.get(
            "status",
            "delivered",
        ),
        "match_id": str(match.id),
        "analysis_id": response_data.get(
            "analysis_id"
        ),
    }


def try_deliver_analysis_now(task_id):
    """
    Best-effort immediate attempt.

    If events are still being persisted or the Analysis Service is
    unavailable, run_task() leaves the durable Task queued for retry.
    """

    from ..task_runner import run_task

    try:
        run_task(task_id)
    except Exception:
        logger.exception(
            "immediate analysis delivery interrupted; "
            "worker will retry task=%s",
            task_id,
        )
