"""Durable status transitions and compatibility for previously queued snapshots."""

import copy
import json
import logging
import time
import uuid

import httpx
from django.conf import settings
from django.db import connection
from django.utils import timezone

from .models import TournamentLink
from .signing import sign_result_body

logger = logging.getLogger(__name__)

LIVE_PATH = '/api/gamelink/live/'
TIMEOUT_SECONDS = 2.0
STATUS_TASK = 'game.link.live.deliver_status_event'
STATUS_EVENT_TYPES = {'started', 'admin_required', 'admin_cleared'}


def enqueue_status_event(room, event_type):
    """Caller holds the room lock in the transaction that changed its status.

    Allocate a revision under the link lock and freeze the body in the existing
    Task row. Its UUID is also the delivery identity; retries only change HMAC
    timestamps/nonces. No HTTP is performed by this transaction or its commit.
    """
    from game.models import Task

    if not connection.in_atomic_block:
        raise RuntimeError('Status events must be queued inside the room transaction')
    if event_type not in STATUS_EVENT_TYPES:
        raise ValueError('Unknown status event type')
    if not settings.GAMELINK_ENABLED:
        return None
    link = TournamentLink.objects.select_for_update().filter(room_id=room.pk).first()
    if link is None or room.status != 'playing':
        return None

    occurred_at = timezone.now()
    link.status_event_revision += 1
    if event_type == 'started':
        link.status_started_at = occurred_at
    link.save(update_fields=['status_event_revision', 'status_started_at'])
    task = Task(name=STATUS_TASK, run_at=occurred_at)
    body = _snapshot_body(link, room)
    body.update(
        event_id=str(task.pk), event_type=event_type,
        event_revision=link.status_event_revision,
        occurred_at=occurred_at.isoformat(),
        started_at=link.status_started_at.isoformat() if link.status_started_at else None,
    )
    task.kwargs = {'body': copy.deepcopy(body)}
    task.save()
    return task


def deliver_status_event(body):
    """Deliver exactly the saved transition through the leased task worker."""
    from game.task_runner import NonRetryableTaskError

    response = _send_snapshot(body, raise_on_error=True, durable=True)
    try:
        acknowledgement = response.json()
    except ValueError:
        acknowledgement = None
    if not isinstance(acknowledgement, dict) or acknowledgement.get('event_id') != body['event_id']:
        # A receiver running the old snapshot code must not make the new worker
        # believe it applied revision ordering. Upgrade the receiver first.
        raise RuntimeError('Status event receiver did not acknowledge the event identity')
    if acknowledgement.get('status') not in ('recorded', 'already_recorded'):
        raise NonRetryableTaskError('Status event receiver returned an unknown acknowledgement')
    return {'event_id': body['event_id'], 'status': acknowledgement['status']}


def publish_snapshot(room_id, state=None, *, raise_on_error=False):
    """Send one coherent persisted room snapshot.

    ``state`` remains accepted for already queued tasks and existing callers.
    Their captured state can be older than the room by execution time, so it
    must never be combined with a newer persisted sequence or score.
    """
    if not settings.GAMELINK_ENABLED:
        return

    link = TournamentLink.objects.filter(room_id=room_id).select_related('room__gamestate').first()
    if link is None:
        return

    _send_snapshot(_snapshot_body(link, link.room), raise_on_error=raise_on_error)


def _snapshot_body(link, room):
    game_state = getattr(room, 'gamestate', None)
    state = game_state.state_data if game_state is not None else {}
    state = state or {}
    presence = dict((room.state or {}).get('presence') or {})
    return {
        'v': 1,
        'tournament_id': link.tournament_id,
        'fixture_id': link.fixture_id,
        'room_id': str(room.id),
        'sequence': room.last_sequence,
        'status': room.status,
        'state': {
            'phase': state.get('phase'),
            'turn': state.get('turn'),
            'dice': state.get('dice'),
            'cube': state.get('cube'),
            'cubeOwner': state.get('cubeOwner'),
            'doubleOfferedBy': state.get('doubleOfferedBy'),
            'clock': state.get('clock'),
            'presence': {
                'needsAdminAdjudication': bool(presence.get('needsAdminAdjudication')),
                'absentSince': dict(presence.get('absentSince') or {}),
            },
        },
        'match_score': {'white': room.white_score, 'black': room.black_score},
    }


def _send_snapshot(body, *, raise_on_error=False, durable=False):
    from game.task_runner import NonRetryableTaskError

    base_url = settings.GAMELINK_TOURNAMENTS_URL.rstrip('/')
    if not base_url:
        raise RuntimeError('GAMELINK_TOURNAMENTS_URL is not configured')
    raw = json.dumps(body, separators=(',', ':'), sort_keys=True).encode()
    timestamp = str(int(timezone.now().timestamp()))
    nonce = uuid.uuid4().hex
    headers = {
        'Content-Type': 'application/json',
        'X-Gamelink-Timestamp': timestamp,
        'X-Gamelink-Nonce': nonce,
        'X-Gamelink-Signature': sign_result_body(raw, timestamp, nonce),
        'X-Gamelink-Issuer': settings.GAMELINK_ISSUER,
        'X-Snapshot-ID': body.get('event_id', nonce),
    }
    started = time.perf_counter()
    try:
        response = httpx.post(
            f'{base_url}{LIVE_PATH}',
            content=raw,
            headers=headers,
            timeout=TIMEOUT_SECONDS,
        )
        if (durable and not 200 <= response.status_code < 300
                and response.status_code < 500 and response.status_code not in (408, 429)):
            raise NonRetryableTaskError(
                f"Status event {body['event_id']} refused with HTTP {response.status_code}")
        response.raise_for_status()
    except httpx.HTTPError as error:
        response = getattr(error, 'response', None)
        logger.warning(
            'event=snapshot_delivery_failed tournament_id=%s fixture_id=%s room_id=%s '
            'sequence=%s status_code=%s error_type=%s retryable=%s snapshot_id=%s duration_ms=%s',
            body['tournament_id'], body['fixture_id'], body['room_id'], body['sequence'],
            getattr(response, 'status_code', None), type(error).__name__, raise_on_error,
            body.get('event_id', nonce), round((time.perf_counter() - started) * 1000, 1),
        )
        if raise_on_error:
            raise
    else:
        logger.debug('event=snapshot_delivered snapshot_id=%s fixture_id=%s sequence=%s duration_ms=%s',
                     body.get('event_id', nonce), body['fixture_id'], body['sequence'],
                     round((time.perf_counter() - started) * 1000, 1))
        return response
