import uuid
import logging

from django.contrib.auth.models import User

logger = logging.getLogger(__name__)
from django.db import models as db_models
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from django.db.models import Q
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .engine import BackgammonEngine
from .game_service import finalize_room
from .models import GameRoom, GameState, Match, Player, RoomPlayer
from .serializers import RegisterSerializer, UserSerializer, MatchSerializer, PlayerSerializer


def get_or_create_player(user):
    player, _ = Player.objects.get_or_create(user=user)
    return player


def room_players_data(room):
    white_rp = room.players.filter(color='white').first()
    black_rp = room.players.filter(color='black').first()
    return {
        'whitePlayer': PlayerSerializer(white_rp.player).data if white_rp else None,
        'blackPlayer': PlayerSerializer(black_rp.player).data if black_rp else None,
    }


@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    return Response({'status': 'ok', 'message': 'Backgammon server is running'})


@api_view(['POST'])
@permission_classes([AllowAny])
def client_log(request):
    data = request.data
    level = data.get('level', 'info')
    msg = data.get('message', '')
    meta = data.get('meta', {})
    log_line = f"[CLIENT] {msg} | meta={meta}"
    if level == 'error':
        logger.error(log_line)
    elif level == 'warn':
        logger.warning(log_line)
    else:
        logger.info(log_line)
    return Response({'status': 'ok'})


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    logger.info(f"Register attempt: username={request.data.get('username')}")
    serializer = RegisterSerializer(data=request.data)
    if not serializer.is_valid():
        logger.warning(f"Register validation failed: {serializer.errors}")
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    user = serializer.save()
    logger.info(f"User registered: {user.username} (id={user.id})")
    refresh = RefreshToken.for_user(user)
    refresh['username'] = user.username
    return Response({
        'user': UserSerializer(user).data,
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def create_room(request):
    user = request.user
    logger.info(f"Create room attempt: user={user.username}")
    player = get_or_create_player(user)
    active_rooms = GameRoom.objects.filter(
        players__player=player,
        status__in=['waiting', 'playing']
    )
    if active_rooms.exists():
        # If the active room's game is already over, close it so the player is
        # never stuck and can open a new room.
        active = active_rooms.first()
        gs = GameState.objects.filter(room=active).first()
        state = (gs.state_data if gs else {}) or {}
        if active.status == 'playing' and state.get('phase') == 'game_over' and state.get('winner'):
            finalize_room(active, state, state['winner'], state.get('winType', 'single'), 'state_update')
            logger.info(f"Stale game-over room finalized on create: room={active.code} user={user.username}")
        else:
            logger.warning(f"User already in a room: user={user.username}")
            return Response({'error': 'Already in a room'}, status=status.HTTP_400_BAD_REQUEST)

    target = request.data.get('targetPoints', 7)
    preferred_color = request.data.get('preferredColor', 'white')
    if preferred_color not in ('white', 'black'):
        preferred_color = 'white'

    time_control = request.data.get('time', '2+12')
    if time_control not in ('none', '1+5', '2+12', '5+12'):
        time_control = '2+12'

    room = GameRoom.objects.create(
        code=uuid.uuid4().hex[:6].upper(),
        status='waiting',
        target_points=target,
        time_control=time_control,
        white_score=0,
        black_score=0,
    )
    RoomPlayer.objects.create(room=room, player=player, color=preferred_color)
    initial = BackgammonEngine.get_initial_state()
    room.state = initial
    room.save()
    GameState.objects.create(room=room, state_data=initial)
    logger.info(f"Room created: code={room.code} by user={user.username}")

    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'targetPoints': target,
        'timeControl': time_control,
        **room_players_data(room),
    }, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def join_room(request):
    code = request.data.get('code', '').upper().strip()
    user = request.user
    logger.info(f"Join room attempt: code={code} user={user.username}")
    player = get_or_create_player(user)
    try:
        room = GameRoom.objects.get(code=code, status='waiting')
    except GameRoom.DoesNotExist:
        logger.warning(f"Room not found: code={code}")
        return Response({'error': 'Room not found or already full'}, status=status.HTTP_404_NOT_FOUND)
    if room.players.count() >= 2:
        logger.warning(f"Room full: code={code}")
        return Response({'error': 'Room is full'}, status=status.HTTP_400_BAD_REQUEST)
    if room.players.filter(player=player).exists():
        logger.warning(f"User already in room: user={user.username} code={code}")
        return Response({'error': 'You are already in this room'}, status=status.HTTP_400_BAD_REQUEST)
    taken_colors = set(room.players.values_list('color', flat=True))
    color = 'black' if 'white' in taken_colors else 'white'
    RoomPlayer.objects.create(room=room, player=player, color=color)
    room.status = 'playing'
    room.save()
    logger.info(f"User joined room: user={user.username} code={code} color={color}")

    # The room starts when the second player is assigned, not only when that
    # player later opens a WebSocket. This wakes the creator from WaitingRoom.
    channel_layer = get_channel_layer()
    if channel_layer:
        async_to_sync(channel_layer.group_send)(
            f'game_{room.id}',
            {'type': 'room_started'}
        )
    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'targetPoints': room.target_points,
        **room_players_data(room),
    })


@api_view(['GET'])
def room_detail(request, code):
    try:
        room = GameRoom.objects.get(code=code.upper())
    except GameRoom.DoesNotExist:
        return Response({'error': 'Room not found'}, status=status.HTTP_404_NOT_FOUND)
    return Response({
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'targetPoints': room.target_points,
        'timeControl': room.time_control,
        **room_players_data(room),
        'state': room.state,
    })


@api_view(['POST'])
def cancel_room(request):
    """Cancel the current player's active room."""
    user = request.user
    player = get_or_create_player(user)
    room = GameRoom.objects.filter(
        players__player=player,
        status__in=['waiting', 'playing']
    ).first()
    if not room:
        return Response({'error': 'No active room'}, status=status.HTTP_404_NOT_FOUND)
    room.status = 'cancelled'
    room.save()
    return Response({'status': 'cancelled', 'roomId': str(room.id)})


@api_view(['POST'])
def save_match(request):
    user = request.user
    data = request.data

    def resolve_player_id(raw_id):
        if raw_id is None:
            return None
        # Frontend sends a User id (from JWT). Resolve to the Player.
        try:
            return Player.objects.get(user_id=int(raw_id)).id
        except (Player.DoesNotExist, ValueError, TypeError):
            return None

    match = Match.objects.create(
        white_player_id=resolve_player_id(data.get('white_player_id')),
        black_player_id=resolve_player_id(data.get('black_player_id')),
        match_type=data.get('match_type', 'online'),
        target_points=data.get('target_points', 7),
        white_score=data.get('white_score', 0),
        black_score=data.get('black_score', 0),
        winner=data.get('winner'),
        games=data.get('games', []),
        duration_seconds=data.get('duration_seconds'),
    )
    return Response(MatchSerializer(match).data, status=201)


@api_view(['GET'])
def list_matches(request):
    user = request.user
    player = get_or_create_player(user)
    matches = Match.objects.filter(
        Q(white_player=player) | Q(black_player=player)
    ).order_by('-created_at')
    page = int(request.GET.get('page', 1))
    page_size = 20
    start = (page - 1) * page_size
    end = start + page_size
    total = matches.count()
    return Response({
        'matches': MatchSerializer(matches[start:end], many=True).data,
        'total': total,
        'page': page,
        'page_size': page_size,
    })


@api_view(['GET'])
def match_detail(request, pk):
    try:
        match = Match.objects.get(id=pk)
    except Match.DoesNotExist:
        return Response({'error': 'Match not found'}, status=404)
    return Response(MatchSerializer(match).data)


@api_view(['GET'])
def player_stats(request):
    user = request.user
    player = get_or_create_player(user)
    matches = Match.objects.filter(Q(white_player=player) | Q(black_player=player))
    total_matches = matches.count()
    if total_matches == 0:
        return Response({
            'total_matches': 0, 'matches_won': 0, 'match_win_rate': 0,
            'total_games': 0, 'games_won': 0, 'game_win_rate': 0,
            'single_wins': 0, 'gammon_wins': 0, 'backgammon_wins': 0,
            'current_streak': 0, 'longest_streak': 0,
        })

    matches_won = 0
    total_games = 0
    games_won = 0
    single_wins = 0
    gammon_wins = 0
    backgammon_wins = 0
    recent_results = []

    for m in matches.order_by('-created_at'):
        user_color = 'white' if m.white_player == player else 'black'
        if m.winner == user_color:
            matches_won += 1
            recent_results.append('W')
        elif m.winner:
            recent_results.append('L')

        for game in m.games:
            total_games += 1
            if game.get('winner') == user_color:
                games_won += 1
                wt = game.get('win_type', 'single')
                if wt == 'single': single_wins += 1
                elif wt == 'gammon': gammon_wins += 1
                elif wt == 'backgammon': backgammon_wins += 1

    current_streak = 0
    longest_streak = 0
    streak = 0
    for r in recent_results:
        if r == 'W':
            streak += 1
            longest_streak = max(longest_streak, streak)
        else:
            streak = 0
    current_streak = streak if recent_results and recent_results[0] == 'W' else 0
    if recent_results and recent_results[0] == 'W':
        current_streak = streak

    return Response({
        'total_matches': total_matches,
        'matches_won': matches_won,
        'match_win_rate': round(matches_won / total_matches, 3) if total_matches > 0 else 0,
        'total_games': total_games,
        'games_won': games_won,
        'game_win_rate': round(games_won / total_games, 3) if total_games > 0 else 0,
        'single_wins': single_wins,
        'gammon_wins': gammon_wins,
        'backgammon_wins': backgammon_wins,
        'current_streak': current_streak,
        'longest_streak': longest_streak,
    })
