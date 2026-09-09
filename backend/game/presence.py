"""Shared, restart-tolerant presence tracking for active game rooms."""

import time
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from .game_service import finalize_room, game_ended_payload
from .models import GameRoom, GameState, Task


ABSENCE_SECONDS = 40
HEARTBEAT_SECONDS = 10
STALE_SECONDS = 25
WATCH_SECONDS = 10
WATCH_TASK = 'game.presence.check_room_presence'


def _presence(room):
    state = dict(room.state or {})
    presence = dict(state.get('presence') or {})
    presence['connections'] = dict(presence.get('connections') or {})
    presence['absentSince'] = dict(presence.get('absentSince') or {})
    return state, presence


def _colors(presence):
    return {entry.get('color') for entry in presence['connections'].values()}


def _schedule(room_id, delay=WATCH_SECONDS):
    Task.objects.create(
        name=WATCH_TASK,
        args=[str(room_id)],
        run_at=timezone.now() + timedelta(seconds=delay),
        max_attempts=3,
    )


def _publish_admin_transition(room):
    snapshot_state = dict(
        GameState.objects.filter(room=room)
        .values_list('state_data', flat=True)
        .first() or {}
    )
    task = Task.objects.create(
        name='game.link.live.publish_snapshot',
        args=[str(room.id), snapshot_state],
        kwargs={'raise_on_error': True},
        run_at=timezone.now(),
        max_attempts=3,
    )
    from .task_runner import run_task
    transaction.on_commit(lambda task_pk=task.pk: run_task(task_pk))


@transaction.atomic
def mark_connected(room_id, channel_name, color, now=None):
    now = time.time() if now is None else now
    room = GameRoom.objects.select_for_update().get(pk=room_id)
    state, presence = _presence(room)
    presence['connections'][channel_name] = {'color': color, 'lastSeen': now}
    colors = _colors(presence)
    if {'white', 'black'} <= colors:
        first_full_presence = not presence.get('everBothConnected', False)
        presence['everBothConnected'] = True
        # Once both players have gone missing, only an organizer may resolve
        # the match. Reconnecting must not silently resume automatic forfeits.
        if not presence.get('needsAdminAdjudication'):
            presence['absentSince'] = {}
        if first_full_presence:
            _schedule(room.id)
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])


@transaction.atomic
def mark_heartbeat(room_id, channel_name, now=None):
    now = time.time() if now is None else now
    room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
    if not room:
        return
    state, presence = _presence(room)
    entry = presence['connections'].get(channel_name)
    if not entry:
        return
    presence['connections'][channel_name] = {**entry, 'lastSeen': now}
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])


@transaction.atomic
def mark_disconnected(room_id, channel_name, now=None):
    now = time.time() if now is None else now
    room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
    if not room:
        return False
    state, presence = _presence(room)
    previous_needs_admin = bool(presence.get('needsAdminAdjudication'))
    removed = presence['connections'].pop(channel_name, None)
    if not removed:
        return False
    color = removed.get('color')
    colors = _colors(presence)
    if presence.get('everBothConnected') and color not in colors:
        presence['absentSince'][color] = now
        missing = {'white', 'black'} - colors
        if len(missing) == 2:
            presence['needsAdminAdjudication'] = True
        _schedule(room.id, WATCH_SECONDS if len(missing) == 2 else ABSENCE_SECONDS)
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])
    if previous_needs_admin != bool(presence.get('needsAdminAdjudication')):
        game_state = GameState.objects.select_for_update().filter(room=room).first()
        if game_state:
            frozen = dict(game_state.state_data or {})
            frozen['turnStartedAt'] = None
            game_state.state_data = frozen
            game_state.save(update_fields=['state_data', 'updated_at'])
        _publish_admin_transition(room)
    return presence.get('everBothConnected', False)


def needs_admin_adjudication(room):
    return bool(((room.state or {}).get('presence') or {}).get('needsAdminAdjudication'))


def check_room_presence(room_id, now=None):
    """Forfeit one absent player after 40s; never choose a winner if both are absent."""
    now = time.time() if now is None else now
    loser = None
    payload = None
    with transaction.atomic():
        room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
        if not room or room.status != 'playing':
            return {'status': 'closed'}
        state, presence = _presence(room)
        if not presence.get('everBothConnected'):
            return {'status': 'not_started'}
        previous_needs_admin = bool(presence.get('needsAdminAdjudication'))

        for connection_id, entry in list(presence['connections'].items()):
            if now - float(entry.get('lastSeen', 0)) > STALE_SECONDS:
                presence['connections'].pop(connection_id, None)
                color = entry.get('color')
                presence['absentSince'].setdefault(
                    color, float(entry.get('lastSeen', now)) + STALE_SECONDS
                )

        colors = _colors(presence)
        missing = {'white', 'black'} - colors
        if presence.get('needsAdminAdjudication'):
            # Sticky terminal-review state: a later reconnect cannot create an
            # automatic winner after both players were absent together.
            missing = {'white', 'black'} - colors
        elif len(missing) == 1:
            presence['needsAdminAdjudication'] = False
            color = next(iter(missing))
            absent_since = presence['absentSince'].setdefault(color, now)
            if now - float(absent_since) >= ABSENCE_SECONDS:
                loser = color
            else:
                _schedule(room.id, ABSENCE_SECONDS - (now - float(absent_since)))
        elif len(missing) == 2:
            presence['needsAdminAdjudication'] = True
        elif not missing:
            presence['absentSince'] = {}
            presence['needsAdminAdjudication'] = False

        state['presence'] = presence
        room.state = state
        room.save(update_fields=['state', 'updated_at'])
        if previous_needs_admin != bool(presence.get('needsAdminAdjudication')):
            _publish_admin_transition(room)
        if not loser:
            if presence.get('needsAdminAdjudication'):
                return {'status': 'admin_required', 'missing': sorted(missing)}
            if len(missing) != 1:
                _schedule(room.id)
            return {'status': 'waiting', 'missing': sorted(missing)}

        # Keep the eligibility decision and finalization under the same room
        # lock so a reconnect cannot race between them.
        game_state = GameState.objects.select_for_update().get(room=room)
        state_data = dict(game_state.state_data or {})
        winner = 'black' if loser == 'white' else 'white'
        state_data.update(
            phase='game_over', winner=winner, winType='single',
            gameEndReason='disconnect', message=f'{loser} disconnected for 40 seconds',
        )
        match = finalize_room(room, state_data, winner, 'single', 'disconnect')
        if match is None:
            return {'status': 'closed'}
        room.refresh_from_db()
        payload = game_ended_payload(state_data, winner, 'single', 'disconnect', room)
        payload.update(
            matchId=str(match.id), matchOver=True, nextGame=False,
        )

    async_to_sync(get_channel_layer().group_send)(
        f'game_{room_id}', {'type': 'game_ended', 'payload': payload}
    )
    return {'status': 'forfeited', 'loser': loser, 'winner': winner}
