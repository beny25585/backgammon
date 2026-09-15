import json
import time
import uuid

import httpx
from django.conf import settings

from .signing import sign_result_body


class RematchServiceError(Exception):
    def __init__(self, message, *, status_code=None, code=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def send_direct_play_rematch_action(*, link, room, actor_color, action):
    if action not in ('request', 'accept', 'decline', 'cancel', 'disconnect'):
        raise RematchServiceError(f'unknown rematch action: {action}')

    base = (getattr(settings, 'GAMELINK_TOURNAMENTS_URL', '') or '').rstrip('/')
    if not base:
        raise RematchServiceError('GAMELINK_TOURNAMENTS_URL is not configured')

    # Derive actor seat from link colors
    p1_color = link.color_for_seat('p1')
    p2_color = link.color_for_seat('p2')
    if actor_color == p1_color:
        actor_seat = 'p1'
    elif actor_color == p2_color:
        actor_seat = 'p2'
    else:
        raise RematchServiceError('actor color not in link')

    body = {
        'v': 1,
        'action': action,
        'source_table_id': -link.fixture_id,
        'room_id': str(room.id),
        'actor_seat': actor_seat,
    }
    raw = json.dumps(body, separators=(',', ':'), sort_keys=True).encode()
    timestamp = str(int(time.time()))
    nonce = uuid.uuid4().hex
    headers = {
        'Content-Type': 'application/json',
        'X-Gamelink-Timestamp': timestamp,
        'X-Gamelink-Nonce': nonce,
        'X-Gamelink-Signature': sign_result_body(raw, timestamp, nonce),
        'X-Gamelink-Issuer': settings.GAMELINK_ISSUER,
    }
    url = f"{base}/api/gamelink/rematch/"
    try:
        resp = httpx.post(url, content=raw, headers=headers, timeout=10.0)
    except Exception as exc:
        raise RematchServiceError(f'rematch service unreachable: {exc}') from exc

    if resp.status_code < 200 or resp.status_code >= 300:
        code = None
        try:
            payload = resp.json()
            if isinstance(payload, dict):
                code = payload.get("code")
        except Exception:
            payload = None
        raise RematchServiceError(
            "Rematch request rejected",
            status_code=resp.status_code,
            code=code,
        )

    try:
        return resp.json()
    except Exception:
        return {}
