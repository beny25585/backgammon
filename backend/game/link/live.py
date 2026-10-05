"""Best-effort live snapshots for externally linked tournament fixtures."""

import json
import logging
import uuid

import httpx
from django.conf import settings
from django.utils import timezone

from .models import TournamentLink
from .signing import sign_result_body

logger = logging.getLogger(__name__)

LIVE_PATH = '/api/gamelink/live/'
TIMEOUT_SECONDS = 2.0


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

    room = link.room
    game_state = getattr(room, 'gamestate', None)
    state = game_state.state_data if game_state is not None else {}
    state = state or {}
    presence = dict((room.state or {}).get('presence') or {})
    body = {
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
    raw = json.dumps(body, separators=(',', ':'), sort_keys=True).encode()
    timestamp = str(int(timezone.now().timestamp()))
    nonce = uuid.uuid4().hex
    headers = {
        'Content-Type': 'application/json',
        'X-Gamelink-Timestamp': timestamp,
        'X-Gamelink-Nonce': nonce,
        'X-Gamelink-Signature': sign_result_body(raw, timestamp, nonce),
        'X-Gamelink-Issuer': settings.GAMELINK_ISSUER,
    }
    try:
        httpx.post(
            f"{settings.GAMELINK_TOURNAMENTS_URL.rstrip('/')}{LIVE_PATH}",
            content=raw,
            headers=headers,
            timeout=TIMEOUT_SECONDS,
        ).raise_for_status()
    except httpx.HTTPError as error:
        response = getattr(error, 'response', None)
        logger.warning(
            'event=snapshot_delivery_failed tournament_id=%s fixture_id=%s room_id=%s '
            'sequence=%s status_code=%s error_type=%s retryable=%s',
            link.tournament_id, link.fixture_id, room.id, body['sequence'],
            getattr(response, 'status_code', None), type(error).__name__, raise_on_error,
        )
        if raise_on_error:
            raise
