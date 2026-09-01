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


def publish_snapshot(room_id, state):
    """Send an admin-safe state summary for a linked room, if it has one."""
    if not settings.GAMELINK_ENABLED:
        return

    link = TournamentLink.objects.filter(room_id=room_id).select_related('room').first()
    if link is None:
        return

    room = link.room
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
        logger.warning('live snapshot delivery failed for fixture %s: %s', link.fixture_id, error)
