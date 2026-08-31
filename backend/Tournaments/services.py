import logging
import uuid
from django.db import transaction
from django.utils import timezone
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync


from game.engine import BackgammonEngine
from game.models import BracketMatch, GameRoom, GameState, RoomPlayer, Tournament, TournamentSignup


logger = logging.getLogger(__name__)


def _next_power_of_2(n: int) -> int:
    return 1 << (n - 1).bit_length() if n > 0 else 1


def _pair_slots(items):
    for i in range(0, len(items), 2):
        yield (items[i], items[i+1] if i+1 < len(items) else None)


def _create_tournament_room(p_white, p_black, target_points, time_control):
    room = GameRoom.objects.create(
        code=uuid.uuid4().hex[:6].upper(),
        status='playing',
        target_points=target_points,
        time_control=time_control,
        white_score=0,
        black_score=0,
    )
    RoomPlayer.objects.create(room=room, player=p_white, color='white')
    RoomPlayer.objects.create(room=room, player=p_black, color='black')
    initial = BackgammonEngine.get_initial_state()
    room.state = initial
    room.save()
    GameState.objects.create(room=room, state_data=initial)
    logger.debug("room is created", room)
    return room


def _broadcast(tournament, event, payload):
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    async_to_sync(channel_layer.group_send)(
        f'tournament_{tournament.id}',
        {'type': 'tournament_event', 'event': event, 'payload': payload}
    )


def _bracket_payload(tournament):
    from game.serializers import PlayerSerializer
    matches = BracketMatch.objects.filter(
        tournament=tournament).order_by('round_number', 'slot')
    data = []
    for m in matches:
        data.append({
            'id': str(m.id), 'round': m.round_number, 'slot': m.slot,
            'whitePlayer': PlayerSerializer(m.white_player).data if m.white_player else None,
            'blackPlayer': PlayerSerializer(m.black_player).data if m.black_player else None,
            'winner': PlayerSerializer(m.winner).data if m.winner else None,
            'status': m.status,
            'roomId': str(m.room_id) if m.room_id else None,
            'roomCode': m.room.code if m.room else None,
        })
    return data


def check_if_tournamet_exsist(tournament_id):
    try:
        tid = uuid.UUID(str(tournament_id))
    except ValueError:
        return logger.error(f"start_tournament invalid id {tournament_id}")
    with transaction.atomic():
        try:
            t = Tournament.objects.select_for_update().get(id=tid)
        except Tournament.DoesNotExist:
            return logger.warning(f"start_tournament tournament not found {tid}")

        return t


def check_tournament_can_start(tournament):
    if tournament.status != 'scheduled':
        return logger.debug(f"{tournament.status}")
    if tournament.starts_at > timezone.now():
        return logger.debug(f"{tournament.start_at}")


def start_tournament(tournament_id: str):

    t = check_if_tournamet_exsist(tournament_id)

    if check_tournament_can_start(t):
        return "need to impliment checks"

    signups = list(TournamentSignup.objects.filter(
        tournament=t).select_related('player').order_by('created_at'))

    # enforce max_players FIFO
    # shood not be posible to sign!!!
    if t.max_players and len(signups) > t.max_players:
        signups = signups[:t.max_players]
        # delete excess signups beyond max
        excess = TournamentSignup.objects.filter(
            tournament=t).order_by('created_at')[t.max_players:]
        for s in excess:
            s.delete()
    if len(signups) < t.min_players:
        t.status = 'cancelled'
        t.save()
        _broadcast(t, 'tournament_cancelled', {'reason': 'not_enough_players'})
        return
    # assign seeds
    for idx, s in enumerate(signups):
        s.seed = idx + 1
        s.save()
    bracket_size = _next_power_of_2(len(signups))
    random.shuffle(signups)  # random, no seed
    players = [s.player for s in signups]
    bracket_size = _next_power_of_2(len(players))
    padded = players + [None] * (bracket_size - len(players))
    for slot, (p_white, p_black) in enumerate(_pair_slots(padded)):
        if p_white and p_black:
            room = _create_tournament_room(
                p_white, p_black, t.target_points, t.time_control)
            BracketMatch.objects.create(tournament=t, round_number=1, slot=slot,
                                        white_player=p_white, black_player=p_black, room=room, status='playing')
        elif p_white or p_black:
            winner = p_white or p_black
            BracketMatch.objects.create(tournament=t, round_number=1, slot=slot,
                                        white_player=p_white, black_player=p_black, winner=winner, status='completed')
    t.status = 'running'
    t.save()
    _broadcast(t, 'tournament_started', {'bracket': _bracket_payload(t)})
    _broadcast(t, 'round_started', {'round': 1, 'matches': [
               m for m in _bracket_payload(t) if m['round'] == 1]})


def report_result(bracket_match_id: str, winner_player_id):
    with transaction.atomic():
        try:
            bm = BracketMatch.objects.select_for_update().get(
                id=uuid.UUID(str(bracket_match_id)))
            t = Tournament.objects.select_for_update().get(id=bm.tournament_id)
        except Exception as e:
            logger.warning(f"report_result lookup failed: {e}")
            return
        if t.status != 'running' or bm.status == 'completed':
            return
        try:
            winner = Player.objects.get(
                id=winner_player_id) if winner_player_id else None
        except Player.DoesNotExist:
            winner = None
        bm.winner = winner
        bm.status = 'completed'
        bm.save()
        if BracketMatch.objects.filter(tournament=t, round_number=bm.round_number).exclude(status='completed').exists():
            _broadcast(t, 'bracket_updated', {'bracket': _bracket_payload(t)})
            return
        winners = [m.winner for m in BracketMatch.objects.filter(
            tournament=t, round_number=bm.round_number).order_by('slot')]
        if len(winners) == 1:
            t.status = 'completed'
            t.champion = winners[0]
            t.save()
            from game.serializers import PlayerSerializer
            _broadcast(t, 'tournament_completed', {'champion': PlayerSerializer(
                winners[0]).data if winners[0] else None})
            _broadcast(t, 'bracket_updated', {'bracket': _bracket_payload(t)})
            return
        next_round = bm.round_number + 1
        for slot, (p_white, p_black) in enumerate(_pair_slots(winners)):
            room = _create_tournament_room(
                p_white, p_black, t.target_points, t.time_control)
            BracketMatch.objects.create(tournament=t, round_number=next_round, slot=slot,
                                        white_player=p_white, black_player=p_black,
                                        room=room, status='playing')
        _broadcast(t, 'bracket_updated', {'bracket': _bracket_payload(t)})
        _broadcast(t, 'round_started', {'round': next_round, 'matches': [
                   m for m in _bracket_payload(t) if m['round'] == next_round]})


def lazy_start_if_due(tournament):
    if tournament.status == 'scheduled' and tournament.starts_at <= timezone.now():
        start_tournament(str(tournament.id))
        tournament.refresh_from_db()
    return tournament
