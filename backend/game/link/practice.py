"""Single-use authenticated handoff from the club into free AI practice."""
import time
from datetime import datetime, timezone

from django.conf import settings
from django.core import signing
from django.db import transaction, IntegrityError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from game.engine import BackgammonEngine
from game.models import AiSession, GameRoom, GameState, RoomPlayer, generate_room_code
from .identity import resolve_user
from .models import RedeemedTicket
from .views import _handoff

SALT = 'gamelink.practice.v1'


def verify_practice_ticket(token):
    for secret in settings.GAMELINK_TICKET_SECRETS:
        if not secret:
            continue
        try:
            data = signing.loads(token, key=secret, salt=SALT, max_age=120)
        except signing.BadSignature:
            continue
        if not isinstance(data, dict):
            break
        if (data.get('v') != 1 or data.get('iss') not in settings.GAMELINK_ACCEPTED_ISSUERS
                or data.get('aud') != settings.GAMELINK_ISSUER
                or data.get('difficulty') not in ('easy', 'medium', 'hard')
                or type(data.get('exp')) is not int or not time.time() < data['exp'] <= time.time() + 120
                or any(not isinstance(data.get(k), str) or not data[k] for k in ('jti', 'sub'))):
            break
        return data
    raise ValueError('Invalid practice ticket')


@api_view(['GET'])
@permission_classes([AllowAny])
def enter_practice(request):
    if not settings.GAMELINK_ENABLED:
        return Response(status=404)
    if not settings.AI_SERVICE_URL or not settings.ANALYSIS_API_TOKEN or not settings.GAMELINK_FRONTEND_URL:
        return Response({'error': 'Computer practice is not configured yet.'}, status=503)
    try:
        data = verify_practice_ticket(request.GET.get('ticket', ''))
    except (ValueError, TypeError):
        return Response({'error': 'Invalid or expired practice link.'}, status=400)
    try:
        with transaction.atomic():
            RedeemedTicket.objects.create(jti=data['jti'], issuer=data['iss'],
                expires_at=datetime.fromtimestamp(data['exp'], tz=timezone.utc))
            user = resolve_user(data['iss'], data['sub'], data.get('name', ''))
            # Re-enter an unfinished practice game instead of orphaning it.
            room = GameRoom.objects.filter(players__player=user.player, status='playing',
                ai_session__isnull=False).order_by('-created_at').first()
            if room is None:
                initial = BackgammonEngine.get_initial_state()
                initial.update(doublingEnabled=False, maxCube=1, gameFormat='match',
                    crawfordGame=True, jacoby=False)
                room = GameRoom.objects.create(code=generate_room_code(), target_points=1,
                    time_control='none', status='playing',
                    state={'ai': {'engine': 'open_sage', 'difficulty': data['difficulty']}})
                GameState.objects.create(room=room, state_data=initial)
                RoomPlayer.objects.create(room=room, player=user.player, color='white')
                AiSession.objects.create(room=room, difficulty=data['difficulty'])
    except IntegrityError:
        return Response({'error': 'This link has already been used. Open practice again.'}, status=409)
    return _handoff(user, room, 'white', settings.GAMELINK_FRONTEND_URL.rstrip('/'))
