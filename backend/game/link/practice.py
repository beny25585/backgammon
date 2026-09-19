"""Prepare an unpaid room, then activate it using a paid, signed club ticket."""
import time
import uuid
from datetime import datetime, timezone

from django.conf import settings
from django.contrib.auth import get_user_model
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
POINTS = (1, 3, 5, 7, 9, 11, 15, 21, 25)
TIMES = ('none', 'fast', 'normal', 'slow')


def verify_practice_ticket(token, purpose='enter'):
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
                or data.get('aud') != settings.GAMELINK_ISSUER or data.get('purpose') != purpose
                or data.get('difficulty') not in ('easy', 'medium', 'hard')
                or type(data.get('tp')) is not int or data['tp'] not in POINTS
                or data.get('tc') not in TIMES or type(data.get('dbl')) is not bool
                or type(data.get('exp')) is not int or not time.time() < data['exp'] <= time.time() + 120
                or any(not isinstance(data.get(k), str) or not data[k] for k in ('jti', 'sub'))):
            break
        uuid.UUID(data['purchase_id'])
        if purpose == 'enter':
            uuid.UUID(data['room_id'])
        return data
    raise ValueError('Invalid practice ticket')


def configured():
    return settings.GAMELINK_ENABLED and settings.AI_SERVICE_URL and settings.ANALYSIS_API_TOKEN and settings.GAMELINK_FRONTEND_URL


@api_view(['POST'])
@permission_classes([AllowAny])
def prepare_practice(request):
    if not configured():
        return Response({'error': 'Practice unavailable'}, status=503)
    try:
        data = verify_practice_ticket(request.data.get('ticket', ''), 'prepare')
    except (ValueError, TypeError, KeyError, AttributeError):
        return Response({'error': 'Invalid practice request'}, status=400)
    with transaction.atomic():
        user = resolve_user(data['iss'], data['sub'], data.get('name', ''))
        get_user_model().objects.select_for_update().get(pk=user.pk)
        session = AiSession.objects.select_related('room').filter(purchase_id=data['purchase_id']).first()
        if session and not session.room.players.filter(player=user.player).exists():
            return Response(status=403)
        if session is None:
            session = AiSession.objects.select_related('room').filter(
                room__players__player=user.player, room__status__in=('waiting', 'playing')).order_by('-room__created_at').first()
        if session is None:
            initial = BackgammonEngine.get_initial_state()
            crawford = data['tp'] == 1
            initial.update(doublingEnabled=data['dbl'] and not crawford,
                doublingAllowed=data['dbl'], maxCube=64, gameFormat='match',
                crawfordGame=crawford, crawfordUsed=False, jacoby=False)
            room = GameRoom.objects.create(code=generate_room_code(), target_points=data['tp'],
                time_control=data['tc'], status='waiting',
                state={'ai': {'engine': 'open_sage', 'difficulty': data['difficulty']}})
            GameState.objects.create(room=room, state_data=initial)
            RoomPlayer.objects.create(room=room, player=user.player, color='white')
            session = AiSession.objects.create(room=room, difficulty=data['difficulty'], purchase_id=data['purchase_id'])
        room = session.room
        state = room.gamestate.state_data
        response = Response({'room_id': str(room.id),
            'purchase_id': str(session.purchase_id) if session.purchase_id else None,
            'options': {'difficulty': session.difficulty, 'tp': room.target_points,
                        'tc': room.time_control, 'dbl': bool(state.get('doublingAllowed', False))}})
        response['Cache-Control'] = 'no-store'
        return response


@api_view(['GET'])
@permission_classes([AllowAny])
def enter_practice(request):
    if not configured():
        return Response({'error': 'Practice unavailable'}, status=503)
    try:
        data = verify_practice_ticket(request.GET.get('ticket', ''))
    except (ValueError, TypeError, KeyError, AttributeError):
        return Response({'error': 'Invalid or expired practice link.'}, status=400)
    try:
        with transaction.atomic():
            RedeemedTicket.objects.create(jti=data['jti'], issuer=data['iss'],
                expires_at=datetime.fromtimestamp(data['exp'], tz=timezone.utc))
            user = resolve_user(data['iss'], data['sub'], data.get('name', ''))
            room = GameRoom.objects.select_for_update().filter(id=data['room_id'],
                players__player=user.player, ai_session__isnull=False).first()
            if room is None or (room.ai_session.purchase_id and str(room.ai_session.purchase_id) != data['purchase_id']):
                return Response({'error': 'Practice purchase does not match room'}, status=403)
            if room.status == 'waiting':
                room.status = 'playing'
                room.save(update_fields=['status', 'updated_at'])
    except IntegrityError:
        return Response({'error': 'This link has already been used. Open practice again.'}, status=409)
    return _handoff(user, room, 'white', settings.GAMELINK_FRONTEND_URL.rstrip('/'))
