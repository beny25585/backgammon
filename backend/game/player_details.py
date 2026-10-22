"""Participant-only, signed reads of game display data. No analysis requests."""
import json
import time
import uuid
from decimal import Decimal, InvalidOperation

import httpx
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .link.models import TournamentLink
from .link.signing import sign_result_body
from .models import RoomPlayer


def _response(data, status=200):
    response = Response(data, status=status)
    response['Cache-Control'] = 'private, no-store'
    return response


def _summary(value):
    if value is None:
        return None
    if not isinstance(value, dict) or type(value.get('rating')) is not int:
        raise ValueError('Invalid player data')
    balance = value.get('balance')
    if not isinstance(balance, str) or not Decimal(balance).is_finite():
        raise ValueError('Invalid balance')
    return {'rating': value['rating'], 'balance': balance}


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def room_player_details(request, room_id):
    if not RoomPlayer.objects.filter(room_id=room_id, player__user=request.user).exists():
        return _response({'detail': 'Room not found.'}, 404)
    link = TournamentLink.objects.filter(room_id=room_id).first()
    if link is None:
        return _response({'players': {}})
    base = (getattr(settings, 'GAMELINK_TOURNAMENTS_URL', '') or '').rstrip('/')
    if (not settings.GAMELINK_ENABLED or not base or link.issuer != 'tournaments'):
        return _response({'detail': 'Player details unavailable.'}, 503)
    body = {'v': 1, 'purpose': 'game_player_details', 'iss': settings.GAMELINK_ISSUER,
            'room_id': str(room_id), 'fixture_id': link.fixture_id,
            'tournament_id': link.tournament_id}
    raw = json.dumps(body, separators=(',', ':'), sort_keys=True).encode()
    timestamp, nonce = str(int(time.time())), uuid.uuid4().hex
    try:
        headers = {'Content-Type': 'application/json', 'X-Gamelink-Timestamp': timestamp,
                   'X-Gamelink-Nonce': nonce, 'X-Gamelink-Issuer': settings.GAMELINK_ISSUER,
                   'X-Gamelink-Signature': sign_result_body(raw, timestamp, nonce)}
        result = httpx.post(base + '/api/gamelink/player-details/', content=raw, headers=headers, timeout=3.0)
        result.raise_for_status()
        players = result.json()['players']
        if not isinstance(players, dict) or set(players) != {'p1', 'p2'}:
            raise ValueError('Invalid seats')
        mapped = {link.color_for_seat(seat): _summary(players[seat]) for seat in ('p1', 'p2')}
    except (httpx.HTTPError, ValueError, KeyError, TypeError, InvalidOperation, ImproperlyConfigured):
        return _response({'detail': 'Player details unavailable.'}, 503)
    return _response({'players': mapped})
