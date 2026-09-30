"""Server-authoritative inactivity tracking (anti-stall rule).

Independent from the match clock: measures time since the responsible
player's last valid server-accepted game action. State lives in the
schemaless ``GameState.state_data`` under ``"inactivity"`` — no migration::

    state["inactivity"] = {
        "player": "white",
        "lastActionAtMs": 1234567890000,
        "warnedAtMs": None,
        "deadlineMs": None,
    }

No decrementing counters are stored. Automatic loss is intentionally not
implemented here yet; the checker reports ``expired_awaiting_loss``.
"""

import logging
import time as time_module
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .clock import active_player

logger = logging.getLogger(__name__)

INACTIVITY_WARN_SECONDS = 60
INACTIVITY_GRACE_SECONDS = 60
INACTIVITY_TASK = 'game.inactivity.check_room_inactivity'
INACTIVITY_WATCHDOG_TASK = 'game.inactivity.check_inactivity_watchdog'
INACTIVITY_WATCHDOG_INTERVAL_SECONDS = 60
INACTIVITY_WATCHDOG_TOLERANCE_SECONDS = 15


def refresh_after_action(new_state, now_ms):
    """Reset/init the inactivity window from the NEW state after a success.

    Every valid server-accepted action by the responsible player restarts the
    window, even mid-turn. A responsibility change starts a fresh window for
    the new player. No responsible player (opening, game over, between
    games) clears the block. Returns the block, or None when nobody is
    responsible.
    """
    responsible = active_player(new_state)
    if responsible is None:
        new_state.pop('inactivity', None)
        return None
    block = {
        'player': responsible,
        'lastActionAtMs': now_ms,
        'warnedAtMs': None,
        'deadlineMs': None,
    }
    new_state['inactivity'] = block
    return block


def _dt_from_ms(moment_ms):
    return timezone.datetime.fromtimestamp(moment_ms / 1000, tz=timezone.utc)


def _schedule_at(room_id, run_at):
    from .models import Task

    Task.objects.create(
        name=INACTIVITY_TASK,
        args=[str(room_id)],
        run_at=run_at,
        max_attempts=3,
    )


def ensure_inactivity_check(room_id):
    """Guarantee a pending durable inactivity check exists for the room.

    Called after every successful action; creates nothing when a check is
    already pending. Stale wake-ups are harmless: the checker re-derives
    everything from the persisted block under lock.
    """
    from .models import Task

    key = str(room_id)
    pending_args = Task.objects.filter(
        name=INACTIVITY_TASK, status='pending',
    ).values_list('args', flat=True)
    for args in pending_args:
        if args and list(args)[:1] == [key]:
            return False
    _schedule_at(room_id, timezone.now() + timedelta(seconds=INACTIVITY_WARN_SECONDS))
    ensure_inactivity_watchdog()
    return True


def check_room_inactivity(room_id, now=None):
    """Enter warning state for a stalling player; never finalize.

    Restart-tolerant like ``presence.check_room_presence``: locks the room,
    re-reads ``GameState``, and decides from persisted state, so a valid
    action that committed before the lock is always honored. Idempotent:
    repeated checks leave an existing absolute deadline unchanged.
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .models import GameRoom, GameState
    from .presence import needs_admin_adjudication

    now_ms = int(now * 1000) if now is not None else int(time_module.time() * 1000)
    with transaction.atomic():
        room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
        if room is None or room.status != 'playing':
            logger.info(
                'INACTIVITY_CHECK_STARTED room_id=%s now_ms=%s room_status=%s',
                room_id,
                now_ms,
                getattr(room, 'status', None),
            )
            return {'status': 'closed'}
        if needs_admin_adjudication(room):
            logger.info(
                'INACTIVITY_CHECK_STARTED room_id=%s now_ms=%s room_status=%s',
                room_id,
                now_ms,
                room.status,
            )
            return {'status': 'admin_review'}
        game_state = GameState.objects.select_for_update().filter(room=room).first()
        if game_state is None:
            logger.info(
                'INACTIVITY_CHECK_STARTED room_id=%s now_ms=%s room_status=%s',
                room_id,
                now_ms,
                room.status,
            )
            return {'status': 'no_state'}
        state = dict(game_state.state_data or {})
        if state.get('phase') == 'game_over':
            logger.info(
                'INACTIVITY_CHECK_STARTED room_id=%s now_ms=%s room_status=%s phase=%s version=%s inactivity=%s',
                room_id,
                now_ms,
                room.status,
                state.get('phase'),
                state.get('version'),
                state.get('inactivity'),
            )
            return {'status': 'over'}
        responsible = active_player(state)
        logger.info(
            'INACTIVITY_CHECK_STARTED room_id=%s now_ms=%s room_status=%s phase=%s active_player=%s version=%s inactivity=%s',
            room_id,
            now_ms,
            room.status,
            state.get('phase'),
            responsible,
            state.get('version'),
            state.get('inactivity'),
        )
        if responsible is None:
            if 'inactivity' in state:
                del state['inactivity']
                game_state.state_data = state
                game_state.save(update_fields=['state_data', 'updated_at'])
            return {'status': 'idle'}
        block = state.get('inactivity')
        if not isinstance(block, dict) or block.get('player') != responsible:
            # Safety net: the pipeline owns init, but any path that bypassed
            # it still gets a fresh window rather than a stale warning.
            state['inactivity'] = {
                'player': responsible,
                'lastActionAtMs': now_ms,
                'warnedAtMs': None,
                'deadlineMs': None,
            }
            game_state.state_data = state
            game_state.save(update_fields=['state_data', 'updated_at'])
            _schedule_at(room_id, _dt_from_ms(now_ms + INACTIVITY_WARN_SECONDS * 1000))
            return {'status': 'initialized'}
        last_action_ms = block.get('lastActionAtMs') or now_ms
        warned_at_ms = block.get('warnedAtMs')
        deadline_ms = block.get('deadlineMs')
        if warned_at_ms is not None and deadline_ms is not None:
            if now_ms >= deadline_ms:
                return _finalize_inactivity_loss(room, state, game_state, block)
            _schedule_at(room_id, _dt_from_ms(deadline_ms))
            return {'status': 'warned'}
        warn_at_ms = last_action_ms + INACTIVITY_WARN_SECONDS * 1000
        if now_ms < warn_at_ms:
            _schedule_at(room_id, _dt_from_ms(warn_at_ms))
            return {'status': 'waiting'}
        # 60s idle: warn, with the deadline anchored to the original action
        # so late task execution cannot extend the player's allowance.
        state['inactivity'] = {
            'player': responsible,
            'lastActionAtMs': last_action_ms,
            'warnedAtMs': now_ms,
            'deadlineMs': last_action_ms
            + (INACTIVITY_WARN_SECONDS + INACTIVITY_GRACE_SECONDS) * 1000,
        }
        # Warning is the only checker transition that changes client-visible
        # state, so it is the only one that advances the authoritative room
        # sequence — same semantics as persist_state_and_advance, inline
        # because this checker already holds the room lock synchronously.
        room.last_sequence += 1
        room.save(update_fields=['last_sequence'])
        state['version'] = room.last_sequence
        game_state.state_data = state
        game_state.save(update_fields=['state_data', 'updated_at'])
        _schedule_at(room_id, _dt_from_ms(state['inactivity']['deadlineMs']))
        logger.info(
            'INACTIVITY_WARNING_PERSISTED room_id=%s player=%s version=%s warnedAtMs=%s deadlineMs=%s',
            room_id,
            responsible,
            state.get('version'),
            state['inactivity']['warnedAtMs'],
            state['inactivity']['deadlineMs'],
        )
        broadcast_state = dict(state)

    group_name = f'game_{room_id}'
    logger.info(
        'INACTIVITY_WARNING_BROADCAST_START room_id=%s group_name=%s version=%s',
        room_id,
        group_name,
        broadcast_state.get('version'),
    )
    try:
        async_to_sync(get_channel_layer().group_send)(
            group_name,
            {
                'type': 'game_message',
                'event_type': 'state_update',
                'payload': broadcast_state,
                'playerColor': responsible,
                'action': 'inactivity_warning',
            },
        )
    except Exception as exc:
        logger.exception(
            'INACTIVITY_WARNING_BROADCAST_FAILED room_id=%s exception=%s',
            room_id,
            exc,
        )
        raise
    logger.info(
        'INACTIVITY_WARNING_BROADCAST_OK room_id=%s group_name=%s version=%s',
        room_id,
        group_name,
        broadcast_state.get('version'),
    )
    return {
        'status': 'warned',
        'player': responsible,
        'deadlineMs': broadcast_state['inactivity']['deadlineMs'],
    }


def _finalize_inactivity_loss(room, state, game_state, block):
    """Finalize an expired inactivity deadline; caller holds room + state locks.

    Re-checks every condition under lock so a valid action that committed just
    before the lock (the 119.9s race) always wins over the timeout. Terminal
    scoring, reporting, and broadcast all reuse the existing forced-ending
    path; ``finalize_room`` idempotency makes repeats safe.
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from .clock import active_player
    from .formats import forfeit_win_type
    from .game_service import finalize_room, game_ended_payload
    from .presence import needs_admin_adjudication

    loser = block.get('player')
    if loser not in ('white', 'black'):
        return {'status': 'closed'}
    fresh = dict((game_state.state_data or {}))
    if fresh.get('phase') == 'game_over':
        return {'status': 'closed'}
    if active_player(fresh) != loser:
        return {'status': 'superseded'}
    current = fresh.get('inactivity')
    if (
        not isinstance(current, dict)
        or current.get('deadlineMs') != block.get('deadlineMs')
        or current.get('warnedAtMs') is None
    ):
        return {'status': 'superseded'}
    if int(time_module.time() * 1000) < int(current['deadlineMs']):
        return {'status': 'waiting'}
    if needs_admin_adjudication(room):
        return {'status': 'admin_review'}

    winner = 'black' if loser == 'white' else 'white'
    state_data = dict(fresh)
    win_type = forfeit_win_type(state_data, loser, reason='inactivity_timeout')
    logger.info(
        'INACTIVITY_FORFEIT_START room_id=%s loser=%s winner=%s deadlineMs=%s',
        room.id,
        loser,
        winner,
        current.get('deadlineMs'),
    )
    state_data.update(
        phase='game_over',
        winner=winner,
        winType=win_type,
        gameEndReason='inactivity_timeout',
        message=f'{loser} was inactive for too long',
    )
    # Game over has no responsible player, so the block goes away with it.
    state_data.pop('inactivity', None)
    match = finalize_room(room, state_data, winner, win_type, 'inactivity_timeout')
    if match is None:
        return {'status': 'closed'}
    logger.info(
        'INACTIVITY_FORFEIT_FINALIZED room_id=%s winner=%s reason=inactivity_timeout',
        room.id,
        winner,
    )
    room.refresh_from_db()
    payload = game_ended_payload(state_data, winner, win_type, 'inactivity_timeout', room)
    payload.update(
        matchId=str(match.id), matchOver=True, nextGame=False,
    )
    group_name = f'game_{room.id}'
    logger.info(
        'INACTIVITY_GAME_ENDED_BROADCAST_START room_id=%s group_name=%s',
        room.id,
        group_name,
    )
    try:
        async_to_sync(get_channel_layer().group_send)(
            group_name, {'type': 'game_ended', 'payload': payload}
        )
    except Exception as exc:
        logger.exception(
            'INACTIVITY_GAME_ENDED_BROADCAST_FAILED room_id=%s exception=%s',
            room.id,
            exc,
        )
        raise
    logger.info(
        'INACTIVITY_GAME_ENDED_BROADCAST_OK room_id=%s group_name=%s',
        room.id,
        group_name,
    )
    return {'status': 'forfeited', 'loser': loser, 'winner': winner}


def ensure_inactivity_watchdog():
    """Guarantee a pending watchdog check exists. Monitoring only."""
    from .models import Task

    pending = Task.objects.filter(
        name=INACTIVITY_WATCHDOG_TASK, status='pending',
    ).exists()
    if pending:
        return False
    Task.objects.create(
        name=INACTIVITY_WATCHDOG_TASK,
        args=[],
        run_at=timezone.now() + timedelta(seconds=INACTIVITY_WATCHDOG_INTERVAL_SECONDS),
        max_attempts=3,
    )
    return True


def check_inactivity_watchdog(now=None):
    """Read-only monitor for the inactivity pipeline. Never mutates rooms.

    Detects overdue warnings/forfeits and re-schedules itself through the
    existing Task infrastructure. Does not warn, forfeit, or write state.
    """
    from .models import GameRoom, GameState, Task

    now_ms = int(now * 1000) if now is not None else int(time_module.time() * 1000)
    tolerance_ms = INACTIVITY_WATCHDOG_TOLERANCE_SECONDS * 1000
    try:
        rooms = list(GameRoom.objects.filter(status='playing').only('id', 'status'))
        for room in rooms:
            game_state = GameState.objects.filter(room=room).first()
            if game_state is None:
                continue
            state = dict(game_state.state_data or {})
            if state.get('phase') == 'game_over':
                continue
            block = state.get('inactivity')
            if not isinstance(block, dict):
                continue
            warned_at_ms = block.get('warnedAtMs')
            deadline_ms = block.get('deadlineMs')
            last_action_ms = block.get('lastActionAtMs')
            player = block.get('player')
            version = state.get('version')
            if warned_at_ms is None:
                if last_action_ms is None:
                    continue
                warn_at_ms = int(last_action_ms) + INACTIVITY_WARN_SECONDS * 1000
                if now_ms > warn_at_ms + tolerance_ms:
                    logger.error(
                        'INACTIVITY_WATCHDOG_WARNING_OVERDUE room_id=%s player=%s version=%s lastActionAtMs=%s warn_at_ms=%s now_ms=%s',
                        room.id,
                        player,
                        version,
                        last_action_ms,
                        warn_at_ms,
                        now_ms,
                    )
            else:
                if deadline_ms is None:
                    continue
                if now_ms > int(deadline_ms) + tolerance_ms:
                    logger.error(
                        'INACTIVITY_WATCHDOG_FORFEIT_OVERDUE room_id=%s player=%s version=%s warnedAtMs=%s deadlineMs=%s now_ms=%s',
                        room.id,
                        player,
                        version,
                        warned_at_ms,
                        deadline_ms,
                        now_ms,
                    )
    finally:
        Task.objects.create(
            name=INACTIVITY_WATCHDOG_TASK,
            args=[],
            run_at=timezone.now() + timedelta(seconds=INACTIVITY_WATCHDOG_INTERVAL_SECONDS),
            max_attempts=3,
        )
    return {'status': 'ok'}
