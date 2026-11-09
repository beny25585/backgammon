"""Run the first tournament opening independently of the players' sockets."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone as datetime_timezone
from math import ceil

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from .clock import active_player, compute_clock, deadline_for
from .dice import fetch_opening_dice
from .engine import BackgammonEngine
from .event_history import event_game_id, persist_game_action
from .formats import forfeit_win_type
from .game_service import finalize_room, game_ended_payload
from .inactivity import ensure_inactivity_check, refresh_after_action
from .models import GameRoom, GameState, Task
from .scheduling import check_ownership, schedule_unique
from .task_runner import run_task


OPENING_RESULT_DELAY = 3.0
OPENING_TASK = 'game.tournament_opening.run_tournament_opening'
CLOCK_TASK = 'game.tournament_opening.check_first_turn_clock'


def _opening_key(room_id):
    return f'tournament-opening:{room_id}'


def schedule_tournament_opening(room_id, run_at=None):
    return schedule_unique(_opening_key(room_id), OPENING_TASK, [str(room_id)], run_at or timezone.now())


def run_queued_tournament_opening(room_id):
    """Let a live socket wake the same durable task when it is already due."""
    task_id = Task.objects.filter(key=_opening_key(room_id)).values_list('pk', flat=True).first()
    return run_task(task_id) if task_id is not None else False


def _broadcast(room_id, event):
    def notify():
        layer = get_channel_layer()
        if layer is not None:
            async_to_sync(layer.group_send)(f'game_{room_id}', event)

    transaction.on_commit(notify, robust=True)


def _at_ms(timestamp):
    return datetime.fromtimestamp(timestamp / 1000, tz=datetime_timezone.utc)


def _persist_roll(room, stored, pair, now):
    engine = BackgammonEngine(deepcopy(stored))
    state = engine.state
    first = state['turn']
    second = 'black' if first == 'white' else 'white'
    first_index = 0 if first == 'white' else 1
    result = engine.roll_opening_die(first, die=pair[first_index])
    if not result['success']:
        raise ValueError(result['message'])
    if state['phase'] == 'opening_roll' and state['openingRoll'][first] is not None:
        engine.roll_opening_die(second, die=pair[1 - first_index])

    now_ms = int(now.timestamp() * 1000)
    clock, started_at, _, _, _ = compute_clock(stored, state, now_ms, room.time_control, room.target_points)
    if clock is not None:
        state.update(clock=clock, turnStartedAt=started_at)
    refresh_after_action(state, now_ms)

    if state['phase'] == 'opening_result':
        ready_ms = ceil((now + timedelta(seconds=OPENING_RESULT_DELAY)).timestamp() * 1000)
        state['openingResultReadyAtMs'] = ready_ms
        ready_at = _at_ms(ready_ms)
    else:
        # An older partial roll can tie the second die. Use a fresh pair on retry.
        state.pop('openingDice', None)
        ready_at = now

    persist_game_action(room.pk, state, first, 'roll',
                        expected_version=room.last_sequence, guard_tournament_state=True)
    schedule_tournament_opening(room.pk, ready_at)
    _broadcast(room.pk, {'type': 'game_message', 'event_type': 'state_update',
                         'payload': state, 'playerColor': first, 'action': 'roll'})
    return {'status': state['phase']}


def _activate_first_turn(room, stored, presence, now):
    from .presence import connected_colors

    ready_at = stored.get('openingResultReadyAtMs')
    if ready_at is not None and now < _at_ms(ready_at):
        schedule_tournament_opening(room.pk, _at_ms(ready_at))
        return {'status': 'opening_result'}

    engine = BackgammonEngine(deepcopy(stored))
    result = engine.activate_opening_move()
    if not result['success']:
        raise ValueError(result['message'])
    state = engine.state
    state.pop('openingResultReadyAtMs', None)

    now_ms = int(now.timestamp() * 1000)
    clock, started_at, active, timed_out, deadline_ms = compute_clock(
        stored, state, now_ms, room.time_control, room.target_points,
    )
    if clock is not None:
        state.update(clock=clock, turnStartedAt=started_at)
    inactivity = refresh_after_action(state, now_ms)

    presence.pop('serverOpeningPending', None)
    colors = connected_colors(room, now.timestamp())
    if not colors:
        presence['openingBothAbsent'] = True
        presence['absentSince'] = {}
    elif {'white', 'black'} <= colors:
        presence.pop('openingBothAbsent', None)
    room.state['presence'] = presence
    room.save(update_fields=['state', 'updated_at'])

    persist_game_action(room.pk, state, None, 'opening_result_done',
                        expected_version=room.last_sequence, guard_tournament_state=True)
    if inactivity is not None:
        ensure_inactivity_check(room.pk)
    if timed_out or deadline_ms is not None:
        schedule_unique(f'first-turn-clock:{room.pk}', CLOCK_TASK,
                        [str(room.pk), event_game_id(state), started_at, active],
                        now if timed_out else _at_ms(deadline_ms))
    _broadcast(room.pk, {'type': 'game_message', 'event_type': 'state_update',
                         'payload': state, 'playerColor': None, 'action': 'opening_result_done'})
    return {'status': 'moving'}


def run_tournament_opening(room_id):
    """Persist the roll and first turn in two retryable, versioned steps."""
    snapshot = GameState.objects.select_related('room').filter(
        room_id=room_id, room__status='playing', room__state__presence__serverOpeningPending=True,
    ).first()
    if snapshot is None:
        return {'status': 'not_pending'}

    stored = snapshot.state_data
    pair = stored.get('openingDice')
    if stored.get('phase') == 'opening_roll' and not pair:
        pair = async_to_sync(fetch_opening_dice)()

    with transaction.atomic():
        room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
        check_ownership(lock=True)
        if room is None or room.status != 'playing':
            return {'status': 'not_pending'}
        presence = (room.state or {}).get('presence') or {}
        if not presence.get('serverOpeningPending'):
            return {'status': 'not_pending'}
        if room.last_sequence != snapshot.room.last_sequence:
            schedule_tournament_opening(room_id)
            return {'status': 'superseded'}

        stored = GameState.objects.get(room=room).state_data
        now = timezone.now()
        if stored.get('phase') == 'opening_roll':
            return _persist_roll(room, stored, pair, now)
        if stored.get('phase') == 'opening_result':
            return _activate_first_turn(room, stored, presence, now)
    return {'status': 'not_pending'}


def check_first_turn_clock(room_id, game_id, started_at, loser):
    """Expire the initial turn even when there is no socket to watch its clock."""
    from .presence import needs_admin_adjudication

    with transaction.atomic():
        room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
        check_ownership(lock=True)
        if room is None or room.status != 'playing' or needs_admin_adjudication(room):
            return {'status': 'closed'}
        state = GameState.objects.get(room=room).state_data
        if (event_game_id(state) != game_id or state.get('turnStartedAt') != started_at
                or active_player(state) != loser):
            return {'status': 'superseded'}

        deadline = deadline_for(state, room.time_control, room.target_points)
        if deadline is None and (state.get('clock') or {}).get(loser) != 0:
            return {'status': 'superseded'}
        if deadline is not None and timezone.now() < _at_ms(deadline):
            schedule_unique(f'first-turn-clock:{room_id}', CLOCK_TASK,
                            [str(room_id), game_id, started_at, loser], _at_ms(deadline))
            return {'status': 'waiting'}

        return settle_tournament_clock(room, state, loser)


def settle_tournament_clock(room, state, loser):
    """Record the expired clock and publish its result under the caller's room lock."""
    winner = 'black' if loser == 'white' else 'white'
    win_type = forfeit_win_type(state, loser, reason='time')
    final = {**state, 'phase': 'game_over', 'winner': winner, 'winType': win_type,
             'clock': {**state['clock'], loser: 0}, 'turnStartedAt': None,
             'message': f'{loser} ran out of time'}
    match = finalize_room(room, final, winner, win_type, 'time', validate_timeout=True)
    if match is None:
        return {'status': 'closed'}
    room.refresh_from_db()
    payload = game_ended_payload(final, winner, win_type, 'time', room)
    payload.update(matchId=str(match.pk), matchOver=True, nextGame=False)
    _broadcast(room.pk, {'type': 'game_ended', 'payload': payload})
    return {'status': 'forfeited', 'loser': loser, 'winner': winner}
