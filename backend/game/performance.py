"""Read historical PR for a room's seats or a signed linked identity."""
import json
import time
import uuid

import httpx
from django.conf import settings
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .link.signing import verify_command_signature
from .models import Player, RoomPlayer

EMPTY = {"pr": None, "matches": 0, "decisions": 0}


def read_performance(player_ids):
    ids = list(dict.fromkeys(player_ids))
    if not ids:
        return {}
    base = getattr(settings, "ANALYSIS_SERVICE_URL", "").rstrip("/")
    token = getattr(settings, "ANALYSIS_API_TOKEN", "")
    if not base or not token:
        raise ValueError("Analysis unavailable")
    response = httpx.get(
        base + "/api/v1/internal/performance/",
        params=[("player", value) for value in ids],
        headers={"Authorization": f"Bearer {token}"}, timeout=3.0,
    )
    response.raise_for_status()
    data = response.json()["players"]
    if not isinstance(data, dict):
        raise ValueError("Invalid performance response")
    return data


def private_response(data, *, status=200):
    response = Response(data, status=status)
    response["Cache-Control"] = "private, no-store"
    return response


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def room_performance(request):
    try:
        room_id = uuid.UUID(request.query_params.get("room", ""))
    except (TypeError, ValueError, AttributeError):
        return private_response({"detail": "Invalid room."}, status=400)
    if not RoomPlayer.objects.filter(room_id=room_id, player__user=request.user).exists():
        return private_response({"detail": "Room not found."}, status=404)
    seats = list(RoomPlayer.objects.filter(room_id=room_id).values("color", "player_id"))
    try:
        players = read_performance(seat["player_id"] for seat in seats)
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return private_response({"detail": "Performance unavailable."}, status=503)
    return private_response({"players": {
        seat["color"]: players.get(str(seat["player_id"]), EMPTY) for seat in seats
    }})


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
def linked_performance(request):
    if not settings.GAMELINK_ENABLED:
        return private_response({"detail": "Not found."}, status=404)
    raw = request.body
    timestamp = request.headers.get("X-Gamelink-Timestamp", "")
    issuer = request.headers.get("X-Gamelink-Issuer", "")
    try:
        sent_at = int(timestamp)
        valid = (issuer in settings.GAMELINK_ACCEPTED_ISSUERS
                 and abs(int(time.time()) - sent_at) <= settings.GAMELINK_COMMAND_CLOCK_SKEW
                 and verify_command_signature(raw, timestamp, request.headers.get("X-Gamelink-Signature")))
    except (TypeError, ValueError):
        valid = False
    if not valid:
        return private_response({"detail": "Unauthorized."}, status=401)
    try:
        body = json.loads(raw)
        if not isinstance(body, dict) or body.get("purpose") != "player_performance" or body.get("iss") != issuer:
            raise ValueError()
        subject = str(uuid.UUID(body["sub"]))
    except (ValueError, KeyError, TypeError, AttributeError):
        return private_response({"detail": "Invalid identity."}, status=400)
    player_id = Player.objects.filter(
        user__linked_identities__issuer=issuer,
        user__linked_identities__external_id=subject,
    ).values_list("id", flat=True).first()
    if player_id is None:
        return private_response(EMPTY)
    try:
        return private_response(read_performance([player_id]).get(str(player_id), EMPTY))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return private_response({"detail": "Performance unavailable."}, status=503)
