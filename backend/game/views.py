import uuid
import logging

from django.contrib.auth.models import User

logger = logging.getLogger(__name__)
from django.db import models as db_models, transaction
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
from .link.models import TournamentLink
from .link.outbox import STATUS_CANCELLED, enqueue_result
from .models import GameRoom, GameState, Match, Player, RoomPlayer
from .serializers import RegisterSerializer, UserSerializer, MatchSerializer, PlayerSerializer
from asgiref.sync import async_to_sync
from .dice import fetch_dice, fetch_opening_dice, fetch_turn_dice, DiceServiceError
from .link.models import TournamentLink as LinkModel


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
    from .operations import delivery_health
    try:
        state = delivery_health()
        return Response({'status': state['status']}, status=200 if state['status'] == 'ok' else 503)
    except Exception:
        logger.exception('game_readiness_failed')
        return Response({'status': 'unavailable'}, status=503)


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
        # never stuck and can open a new room. A mid-match game over (match
        # still active) is not stale: the player should return to that room.
        active = active_rooms.first()
        gs = GameState.objects.filter(room=active).first()
        state = (gs.state_data if gs else {}) or {}
        match_active = (active.state or {}).get('match', {}).get('active')
        if (
            active.status == 'playing'
            and state.get('phase') == 'game_over'
            and state.get('winner')
            and not match_active
        ):
            finalize_room(active, state, state['winner'], state.get('winType', 'single'), 'state_update')
            logger.info(f"Stale game-over room finalized on create: room={active.code} user={user.username}")
        else:
            logger.warning(f"User already in a room: user={user.username}")
            return Response({'error': 'Already in a room'}, status=status.HTTP_400_BAD_REQUEST)

    target = request.data.get('targetPoints', 7)
    preferred_color = request.data.get('preferredColor', 'white')
    if preferred_color not in ('white', 'black'):
        preferred_color = 'white'

    time_control = request.data.get('time', 'normal')
    if time_control not in ('none', 'fast', 'normal', 'slow'):
        time_control = 'normal'

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
def active_room(request):
    """Return the requesting user's active (waiting/playing) room, or null."""
    user = request.user
    player = get_or_create_player(user)
    room = GameRoom.objects.filter(
        players__player=player,
        status__in=['waiting', 'playing']
    ).first()
    if not room:
        return Response({'active': None})
    rp = room.players.filter(player=player).first()
    return Response({'active': {
        'id': str(room.id),
        'code': room.code,
        'status': room.status,
        'playerColor': rp.color if rp else None,
        'targetPoints': room.target_points,
        'timeControl': room.time_control,
        **room_players_data(room),
    }})


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

    with transaction.atomic():
        room.status = 'cancelled'
        room.save()
        link = TournamentLink.objects.filter(room=room).first()
        if link is not None:
            # A deliberate cancellation is not a forfeit — nobody won anything — so the fixture is
            # released rather than decided, and stays scorable by hand.
            enqueue_result(link, None, room, STATUS_CANCELLED, end_reason='cancelled')

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


@api_view(['GET'])
@permission_classes([AllowAny])
def dice_roll(request):
    """Proxy to the Elixir dice service for testing/debugging."""
    dice_type = request.GET.get('type', 'normal')
    try:
        a, b = async_to_sync(fetch_dice)(dice_type)
    except DiceServiceError as exc:
        logger.error(f"dice_roll failed: {exc}")
        return Response({'error': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({'dice': [a, b]})


@api_view(['GET'])
@permission_classes([AllowAny])
def dice_health(request):
    """Health of the Elixir dice service."""
    try:
        async_to_sync(fetch_opening_dice)()
        return Response({'diceService': 'ok'})
    except DiceServiceError as exc:
        logger.error(f"dice_health failed: {exc}")
        return Response({'diceService': 'down', 'error': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def room_finalized_result(request, room_id):
    """Authoritative finalized result for a completed room.

    Returns 202 if the room is not yet finalized or if linked money/tournament
    settlement (RatingResult/WalletTransaction) is still pending. Frontend should
    retry with exponential backoff, not arbitrary setTimeout.
    """
    try:
        room_uuid = uuid.UUID(str(room_id))
    except (ValueError, AttributeError):
        return Response({'detail': 'Invalid room id'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        room = GameRoom.objects.get(id=room_uuid)
    except GameRoom.DoesNotExist:
        return Response({'detail': 'Room not found'}, status=status.HTTP_404_NOT_FOUND)

    # Must be participant
    player = get_or_create_player(request.user)
    if not room.players.filter(player=player).exists():
        # Allow linked rooms where user is not directly in GameRoom but is in tournaments? For now require membership
        # For head-to-head, the room's players are the two users, so check again via TournamentLink? Keep strict.
        return Response({'detail': 'Not a participant of this room'}, status=status.HTTP_403_FORBIDDEN)

    # Room must be completed/cancelled or game_over
    gs = GameState.objects.filter(room=room).first()
    state = (gs.state_data if gs else {}) or {}
    is_over = state.get('phase') == 'game_over' and state.get('winner')
    if room.status not in ('completed', 'cancelled') and not is_over:
        return Response({'detail': 'Room not yet finalized', 'status': room.status}, status=status.HTTP_202_ACCEPTED)

    # Fetch latest Match for this room (authoritative stats)
    match = Match.objects.filter(room=room).order_by('-created_at').first()
    # If no Match yet but room is completed via finalize_room, it should have one
    # For playing rooms that just reached game_over but not yet match_over, match may be None
    # In that case we can still return game-level data from state

    # Determine gameType from link or state
    link = LinkModel.objects.filter(room=room).first()
    game_type = '1v1'
    tournament_id = None
    if link and link.tournament_id and int(link.tournament_id) != 0:
        game_type = 'tournament'
        tournament_id = link.tournament_id
    elif state.get('gameFormat') == 'money':
        game_type = 'quick'
    elif state.get('gameFormat') == 'match':
        game_type = '1v1'

    # Build base result from game backend
    white_rp = room.players.filter(color='white').first()
    black_rp = room.players.filter(color='black').first()
    white_name = str(white_rp.player) if white_rp else None
    black_name = str(black_rp.player) if black_rp else None

    request_color = None
    if white_rp and white_rp.player.user_id == request.user.id:
        request_color = 'white'
    elif black_rp and black_rp.player.user_id == request.user.id:
        request_color = 'black'

    self_seat = None
    opponent_seat = None
    if link and request_color is not None:
        p1_color = link.color_for_seat('p1')
        if request_color == p1_color:
            self_seat = 'p1'
            opponent_seat = 'p2'
        else:
            self_seat = 'p2'
            opponent_seat = 'p1'

    settlement_response = (
        link.result_response
        if link and isinstance(link.result_response, dict)
        else {}
    )

    remote_rating = settlement_response.get('rating')
    remote_money = settlement_response.get('money')

    result = {
        'roomId': str(room.id),
        'gameType': game_type,
        'players': {
            'white': {'username': white_name},
            'black': {'username': black_name},
        },
        'result': {
            'winner': state.get('winner'),
            'winType': state.get('winType'),
            'whiteScore': room.white_score,
            'blackScore': room.black_score,
            'targetPoints': room.target_points,
            'cube': int(state.get('cube', 1) or 1),
            'endReason': state.get('gameEndReason') or state.get('winType') and 'bear_off' or 'move',
            'points': state.get('gameEndPoints'),
        },
        'stats': None,
        'rating': None,
        'money': None,
        'tournament': None,
    }

    # Stats from Match if exists
    if match:
        result['stats'] = {
            'hits': match.hits,
            'doublesOffered': match.doubles_offered,
            'doublesAccepted': match.doubles_accepted,
            'openingRoll': match.opening_roll,
            'firstPlayer': match.first_player,
            'durationSeconds': match.duration_seconds,
            'clockRemaining': match.clock_remaining,
            'finalCube': match.final_cube,
        }
        # Prefer match's end_reason if state doesn't have it
        if not result['result']['endReason'] or result['result']['endReason'] == 'move':
            result['result']['endReason'] = match.end_reason

    # For linked rooms (money/tournament), check if settlement is pending
    # If gameType is quick or tournament and link exists but result_status != delivered,
    # consider it not yet finalized for rating/money.
    # We do not block the whole response; we return what we have and let frontend
    # know rating/money are pending via null.
    # However if the request expects rating and it's not yet available, return 202
    # to signal retry — frontend should check if rating is expected but missing.
    expects_rating = game_type in ('quick', 'tournament')
    expects_money = game_type == 'quick'

    # If this is a linked money/tournament room and the link's result is still pending/queued,
    # signal that the finalized data is not yet available.
    if link and expects_rating:
        # LinkModel.result_status == 'delivered' means tournaments has processed
        # For head-to-head money, the settlement is in HeadToHeadTable, not Link, so check Task
        # For now, if link exists and its result_status is still pending/queued, return 202
        # to avoid stale rating.
        if getattr(link, 'result_status', None) not in (None, 'delivered', 'pending'):
            pass
        # If the link is still pending for a rated mode, we can return 202 to indicate not ready
        # But we don't want to block normal 1v1 (which is not rated) — only if expects_rating/money
        if link.result_status in ('pending', 'queued') and (expects_rating or expects_money):
            # Check if a Match exists — if not, still pending
            # Return 202 so frontend retries with backoff
            return Response({'detail': 'Settlement pending', 'gameType': game_type}, status=status.HTTP_202_ACCEPTED)

    # Tournament details
    if game_type == 'tournament' and link and tournament_id:
        # Minimal tournament info from link; frontend can fetch full bracket via tournaments API
        result['tournament'] = {
            'tournamentId': tournament_id,
            'fixtureId': link.fixture_id,
            'round': None,  # to be enriched via tournaments API if needed
            'status': 'advanced' if result['result']['winner'] and (
                (result['result']['winner'] == 'white' and white_rp and white_rp.player.user_id == request.user.id) or
                (result['result']['winner'] == 'black' and black_rp and black_rp.player.user_id == request.user.id)
            ) else 'eliminated',
            'nextOpponent': None,
        }

    if game_type == 'quick':
        stake = remote_money.get('stake') if isinstance(remote_money, dict) and 'stake' in remote_money else state.get('stake')
        self_change = None
        opponent_change = None
        if isinstance(remote_money, dict) and self_seat and opponent_seat:
            if self_seat == 'p1':
                self_change = remote_money.get('p1Change')
                opponent_change = remote_money.get('p2Change')
            else:
                self_change = remote_money.get('p2Change')
                opponent_change = remote_money.get('p1Change')
        result['money'] = {
            'stake': stake,
            'selfChange': self_change,
            'opponentChange': opponent_change,
        }

    if expects_rating:
        result['rating'] = None
        if (
            self_seat
            and opponent_seat
            and isinstance(remote_rating, dict)
            and isinstance(remote_rating.get(self_seat), dict)
            and isinstance(remote_rating.get(opponent_seat), dict)
        ):
            result['rating'] = {
                'self': remote_rating[self_seat],
                'opponent': remote_rating[opponent_seat],
            }

    return Response(result)
