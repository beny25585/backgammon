"""Shared, restart-tolerant presence tracking for active game rooms."""

import time
import uuid
from datetime import timedelta

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from .clock import active_player, apply_transition, deadline_for, parse_time_control
from .game_service import finalize_room, game_ended_payload
from .formats import forfeit_win_type
from .models import GameRoom, GameState, Task


ABSENCE_SECONDS = 40
HEARTBEAT_SECONDS = 10
STALE_SECONDS = 25
WATCH_SECONDS = 10
ENTRY_CONFIRM_SECONDS = 5
FRIEND_ENTRY_CONFIRMATION = 'friendEntryConfirmation'
WATCH_TASK = 'game.presence.check_room_presence'
ACTIVE_GAME_PHASES = {'rolling', 'moving', 'doubling_offered'}


def requires_entry_confirmation(room, link):
    return link is not None and (
        link.tournament_id > 0
        or (link.tournament_id == 0 and link.fixture_id < 0
            and (room.state or {}).get(FRIEND_ENTRY_CONFIRMATION) is True)
    )


def _waiting_for_entry_confirmation(room):
    return room.status == 'waiting' and requires_entry_confirmation(
        room, getattr(room, 'tournament_link', None),
    )


def _entry_event(room_id, event):
    def notify():
        layer = get_channel_layer()
        if layer:
            async_to_sync(layer.group_send)(f'game_{room_id}', event)
    transaction.on_commit(notify)


def _new_entry_challenge(room, presence, now):
    challenge = uuid.uuid4().hex
    presence['entryChallenge'] = challenge
    presence['entryChallengeAt'] = now
    _entry_event(room.pk, {
        'type': 'entry_challenge',
        'payload': {'challenge': challenge, 'expiresAt': int((now + ENTRY_CONFIRM_SECONDS) * 1000)},
    })


@transaction.atomic
def confirm_room_entry(room_id, channel_name, challenge, now=None):
    """Start only after both current sockets acknowledge the same fresh round."""
    room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
    if not room or not _waiting_for_entry_confirmation(room):
        return False
    now = time.time() if now is None else now
    if (room.state or {}).get(FRIEND_ENTRY_CONFIRMATION) is True:
        from .entry_lifecycle import entry_deadline
        if now >= entry_deadline(room):
            return False
    state, presence = _presence(room)
    entry = presence['connections'].get(channel_name)
    if not entry or not challenge or challenge != presence.get('entryChallenge'):
        return False
    if now - float(presence.get('entryChallengeAt', 0)) > ENTRY_CONFIRM_SECONDS:
        _new_entry_challenge(room, presence, now)
        state['presence'] = presence
        room.state = state
        room.save(update_fields=['state', 'updated_at'])
        return False
    presence['connections'][channel_name] = {
        **entry, 'lastSeen': now, 'entryReadyChallenge': challenge, 'entryReadyAt': now,
    }
    ready_colors = {
        connection.get('color') for connection in presence['connections'].values()
        if connection.get('entryReadyChallenge') == challenge
        and now - float(connection.get('entryReadyAt', 0)) <= ENTRY_CONFIRM_SECONDS
    }
    started = {'white', 'black'} <= ready_colors
    fields = ['state', 'updated_at']
    if started:
        presence['everBothConnected'] = True
        presence['absentSince'] = {}
        presence['needsAdminAdjudication'] = False
        room.status = 'playing'
        fields.append('status')
        link = getattr(room, 'tournament_link', None)
        if link is not None and link.tournament_id > 0:
            from .tournament_opening import schedule_tournament_opening

            presence['serverOpeningPending'] = True
            schedule_tournament_opening(room.pk)
    state['presence'] = presence
    room.state = state
    room.save(update_fields=fields)
    if started:
        from .link.live import enqueue_status_event
        enqueue_status_event(room, 'started')
        _schedule(room.pk)
        _entry_event(room.pk, {'type': 'room_started'})
    return started


@transaction.atomic
def cancel_room_entry(room_id, channel_name):
    room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
    if not room or not _waiting_for_entry_confirmation(room):
        return
    state, presence = _presence(room)
    entry = presence['connections'].get(channel_name)
    if not entry:
        return
    entry = dict(entry)
    entry.pop('entryReadyChallenge', None)
    entry.pop('entryReadyAt', None)
    presence['connections'][channel_name] = entry
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])


def _presence(room):
    state = dict(room.state or {})
    presence = dict(state.get('presence') or {})
    presence['connections'] = dict(presence.get('connections') or {})
    presence['absentSince'] = dict(presence.get('absentSince') or {})
    return state, presence


def _colors(presence):
    return {entry.get('color') for entry in presence['connections'].values()}


def connected_colors(room, now=None):
    if now is None:
        now = time.time()
    _state, presence = _presence(room)
    return _connected_colors(presence, now)


def _connected_colors(presence, now):
    colors = set()
    for entry in presence.get('connections', {}).values():
        last_seen = entry.get('lastSeen')
        try:
            last = float(last_seen)
        except (TypeError, ValueError):
            continue
        if now - last <= STALE_SECONDS:
            color = entry.get('color')
            if color in ('white', 'black'):
                colors.add(color)
    return colors


def both_players_connected(room, now=None):
    return {'white', 'black'} <= connected_colors(room, now)


def _schedule(room_id, delay=WATCH_SECONDS):
    from .scheduling import schedule_unique
    return schedule_unique(f'presence:{room_id}', WATCH_TASK, [str(room_id)],
                           timezone.now() + timedelta(seconds=delay))


def _waiting_tournament_has_both_seats(room, link):
    return (
        room.status == 'waiting' and link is not None
        and link.tournament_id > 0 and room.players.count() == 2
    )


def _track_waiting_tournament_absence(room, presence, colors, now):
    if len(colors) == 1:
        missing = 'black' if 'white' in colors else 'white'
        since = presence['absentSince'].get(missing, now)
        presence['absentSince'] = {missing: since}
        _schedule(room.pk, max(0, ABSENCE_SECONDS - (now - since)))
    else:
        presence['absentSince'] = {}
        if colors:
            _schedule(room.pk)


def track_tournament_entry_after_seating(room, link):
    """The second ticket may arrive after the first socket. Caller locks the room."""
    if not _waiting_tournament_has_both_seats(room, link):
        return
    now = time.time()
    state, presence = _presence(room)
    _track_waiting_tournament_absence(room, presence, _connected_colors(presence, now), now)
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])


def _requires_organizer_adjudication(room):
    link = getattr(room, 'tournament_link', None)
    return link is None or link.tournament_id != 0


def _publish_admin_transition(room):
    from .link.live import enqueue_status_event

    needs_admin = bool(((room.state or {}).get('presence') or {}).get('needsAdminAdjudication'))
    if not needs_admin and room.status == 'playing':
        from .inactivity import ensure_inactivity_check
        ensure_inactivity_check(room.pk, run_at=timezone.now())
        _schedule(room.pk)
    return enqueue_status_event(room, 'admin_required' if needs_admin else 'admin_cleared')


def _set_tournament_pause(room, presence, paused, now, game_state=None):
    """Save the pause and its clock under the caller's room lock."""
    if game_state is None:
        game_state = GameState.objects.select_for_update().filter(room=room).first()
    if game_state is None:
        return

    stored = dict(game_state.state_data or {})
    now_ms = int(now * 1000)
    active = active_player(stored)
    timing = parse_time_control(room.time_control, room.target_points)
    paused_at = presence.get('pausedAtMs')
    if paused_at is None:
        # A lease can expire before the presence worker runs. Freeze at the
        # last observed loss, including the second seat's expired lease.
        losses = [presence['absentSince'].get(color) for color in ('white', 'black')]
        losses.extend(
            float(entry.get('lastSeen', 0)) + STALE_SECONDS
            for entry in presence['connections'].values()
            if now - float(entry.get('lastSeen', 0)) > STALE_SECONDS
        )
        paused_at = min(now_ms, max(
            (int(loss * 1000) for loss in losses if loss is not None),
            default=now_ms,
        ))

    used_delay = presence.pop('pausedTurnDelayUsedMs', 0)
    started = stored.get('turnStartedAt')
    if timing and active and started is not None:
        # Also handles older watchdog holds that left the clock running.
        base_ms, delay_ms = timing
        elapsed = max(0, paused_at - started)
        bank = stored.get('clock') or {'white': base_ms, 'black': base_ms}
        stored['clock'] = apply_transition(bank, active, None, elapsed, delay_ms)
        used_delay = min(elapsed, delay_ms)

    if paused:
        presence['pausedAtMs'] = paused_at
        presence['pausedTurnDelayUsedMs'] = used_delay
        stored['turnStartedAt'] = None
    else:
        presence.pop('pausedAtMs', None)
        stored['turnStartedAt'] = now_ms - used_delay if timing and active else None
        if timing and active and not stored.get('clock'):
            stored['clock'] = dict.fromkeys(('white', 'black'), timing[0])
        inactivity = stored.get('inactivity')
        if inactivity:
            held_ms = max(0, now_ms - paused_at)
            inactivity = dict(inactivity)
            for key in ('lastActionAtMs', 'warnedAtMs', 'deadlineMs'):
                if inactivity.get(key) is not None:
                    inactivity[key] += held_ms
            stored['inactivity'] = inactivity

    presence['needsAdminAdjudication'] = paused
    if not paused:
        presence['absentSince'] = {}
    room.last_sequence += 1
    stored['version'] = room.last_sequence
    room.save(update_fields=['last_sequence'])
    game_state.state_data = stored
    game_state.save(update_fields=['state_data', 'updated_at'])
    _entry_event(room.pk, {
        'type': 'tournament_pause_changed',
        'payload': stored,
        'adminReviewPending': paused,
    })


def _sync_tournament_pause(room, link, presence, colors, now, game_state=None):
    if (room.status != 'playing' or link is None or link.tournament_id <= 0
            or not presence.get('everBothConnected')):
        return
    paused = bool(presence.get('needsAdminAdjudication'))
    # Recover already-confirmed rooms that were using the older opening flow.
    if (not presence.get('serverOpeningPending') and not presence.get('openingBothAbsent')
            and (paused or not colors)
            and presence.get('entryChallenge')):
        if game_state is None:
            game_state = GameState.objects.select_for_update().filter(room=room).first()
        if _before_tournament_opening(room, link, game_state):
            from .tournament_opening import schedule_tournament_opening

            presence['serverOpeningPending'] = True
            if paused:
                presence['openingBothAbsent'] = True
            schedule_tournament_opening(room.pk)

    if presence.get('serverOpeningPending') and not colors:
        presence['openingBothAbsent'] = True
    if not presence.get('serverOpeningPending') and parse_time_control(room.time_control, room.target_points):
        # A timed match stays playable. Start a fresh disconnect grace period
        # for the absent player when the first player returns.
        was_empty = presence.pop('openingBothAbsent', False)
        was_empty = presence.pop('timedBothAbsent', False) or was_empty
        if paused:
            _set_tournament_pause(room, presence, False, now, game_state)
        if not colors:
            presence['timedBothAbsent'] = True
            presence['absentSince'] = {}
        elif was_empty or paused:
            presence['absentSince'] = {color: now for color in {'white', 'black'} - colors}
            if len(colors) == 1:
                _schedule(room.pk, ABSENCE_SECONDS)
        return

    if presence.get('openingBothAbsent'):
        # A player returning from the opening's double absence must not
        # inherit a single-player disconnect deadline from before it.
        presence['absentSince'] = {}
        if {'white', 'black'} <= colors:
            presence.pop('openingBothAbsent')
            _schedule(room.pk)
    if presence.get('serverOpeningPending') or presence.get('openingBothAbsent'):
        if paused:
            _set_tournament_pause(room, presence, False, now, game_state)
        return

    if not paused and not colors:
        _set_tournament_pause(room, presence, True, now, game_state)
    elif paused and {'white', 'black'} <= colors:
        _set_tournament_pause(room, presence, False, now, game_state)


def _settle_late_tournament_entry(room, link, presence, color, colors, now):
    since = presence['absentSince'].get(color)
    if (link is None or link.tournament_id <= 0 or presence.get('needsAdminAdjudication')
            or presence.get('serverOpeningPending') or presence.get('openingBothAbsent')
            or since is None or now - since < ABSENCE_SECONDS or len(colors) != 1 or color in colors):
        return False
    if room.status == 'playing' and not presence.get('everBothConnected'):
        return False
    game_state = GameState.objects.filter(room=room).first()
    # A late arrival cannot beat the deadline just because the worker has not polled yet.
    return (_before_tournament_opening(room, link, game_state)
            and check_room_presence(room.pk, now)['status'] == 'forfeited')


@transaction.atomic
def mark_connected(room_id, channel_name, color, now=None):
    now = time.time() if now is None else now
    room = GameRoom.objects.select_for_update().get(pk=room_id)
    from .entry_lifecycle import expire_unstarted_room
    if expire_unstarted_room(room_id) in ('cancelled', 'missing'):
        # A technical result is replayable even though the unplayed room was cancelled.
        return GameState.objects.filter(room=room, state_data__gameEndReason='forfeit').exists()
    state, presence = _presence(room)
    link = getattr(room, 'tournament_link', None)
    waiting_for_confirmation = _waiting_for_entry_confirmation(room)
    waiting_tournament = _waiting_tournament_has_both_seats(room, link)
    requires_organizer = _requires_organizer_adjudication(room)
    previous_needs_admin = bool(presence.get('needsAdminAdjudication'))
    if not requires_organizer and presence.get('needsAdminAdjudication'):
        presence['needsAdminAdjudication'] = False
        presence['absentSince'] = {}
    previous_colors = _connected_colors(presence, now)
    if ((waiting_tournament or room.status == 'playing')
            and _settle_late_tournament_entry(room, link, presence, color, previous_colors, now)):
        return True
    if waiting_tournament and not previous_colors:
        presence['absentSince'] = {}
    if not previous_colors:
        _sync_tournament_pause(room, link, presence, previous_colors, now)
    presence['connections'][channel_name] = {'color': color, 'lastSeen': now}
    colors = _connected_colors(presence, now)
    _sync_tournament_pause(room, link, presence, colors, now)
    if {'white', 'black'} <= colors and not waiting_for_confirmation:
        first_full_presence = not presence.get('everBothConnected', False)
        presence['everBothConnected'] = True
        if not presence.get('needsAdminAdjudication'):
            presence['absentSince'] = {}
        if first_full_presence:
            _schedule(room.id)
    if waiting_for_confirmation:
        _new_entry_challenge(room, presence, now)
        if waiting_tournament:
            _track_waiting_tournament_absence(room, presence, colors, now)
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])
    if previous_needs_admin != bool(presence.get('needsAdminAdjudication')):
        _publish_admin_transition(room)
    return True


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
    previous_needs_admin = bool(presence.get('needsAdminAdjudication'))
    link = None
    if (room.status in ('waiting', 'playing')
            and now - float(entry.get('lastSeen', 0)) > STALE_SECONDS):
        link = getattr(room, 'tournament_link', None)
        if link is not None and link.tournament_id > 0:
            color = entry['color']
            colors = _connected_colors(presence, now)
            waiting_tournament = _waiting_tournament_has_both_seats(room, link)
            if color not in colors and (waiting_tournament or room.status == 'playing'):
                if _settle_late_tournament_entry(room, link, presence, color, colors, now):
                    return 'cancelled'
                if waiting_tournament:
                    if not colors:
                        presence['absentSince'] = {}
                    _track_waiting_tournament_absence(room, presence, colors | {color}, now)
                elif colors and not presence.get('needsAdminAdjudication'):
                    presence['absentSince'] = {}
            if not colors:
                _sync_tournament_pause(room, link, presence, colors, now)
    presence['connections'][channel_name] = {**entry, 'lastSeen': now}
    if (presence.get('needsAdminAdjudication') or presence.get('openingBothAbsent')
            or presence.get('timedBothAbsent')):
        link = link or getattr(room, 'tournament_link', None)
        _sync_tournament_pause(room, link, presence, _connected_colors(presence, now), now)
    if (_waiting_for_entry_confirmation(room)
            and now - float(presence.get('entryChallengeAt', 0)) >= ENTRY_CONFIRM_SECONDS):
        _new_entry_challenge(room, presence, now)
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])
    if previous_needs_admin != bool(presence.get('needsAdminAdjudication')):
        _publish_admin_transition(room)
    return room.status


@transaction.atomic
def mark_disconnected(room_id, channel_name, now=None):
    now = time.time() if now is None else now
    room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
    if not room:
        return False
    state, presence = _presence(room)
    requires_organizer = _requires_organizer_adjudication(room)
    previous_needs_admin = bool(presence.get('needsAdminAdjudication'))
    removed = presence['connections'].pop(channel_name, None)
    if not removed:
        return False
    color = removed.get('color')
    link = getattr(room, 'tournament_link', None)
    linked_tournament = link is not None and link.tournament_id > 0
    colors = _connected_colors(presence, now) if linked_tournament else _colors(presence)
    if _waiting_tournament_has_both_seats(room, link):
        _track_waiting_tournament_absence(room, presence, _connected_colors(presence, now), now)
    elif room.status == 'playing' and presence.get('everBothConnected') and color not in colors:
        presence['absentSince'][color] = min(now, float(removed.get('lastSeen', now)) + STALE_SECONDS) if linked_tournament else now
        missing = {'white', 'black'} - colors
        if len(missing) == 2:
            if linked_tournament:
                _sync_tournament_pause(room, link, presence, colors, now)
            elif requires_organizer:
                presence['needsAdminAdjudication'] = True
            else:
                presence['needsAdminAdjudication'] = False
                presence['absentSince'] = {}
        if presence.get('timedBothAbsent'):
            _schedule(room.id, 0)
        else:
            _schedule(room.id, WATCH_SECONDS if len(missing) == 2 else ABSENCE_SECONDS)
    state['presence'] = presence
    room.state = state
    room.save(update_fields=['state', 'updated_at'])
    if previous_needs_admin != bool(presence.get('needsAdminAdjudication')):
        if not linked_tournament:
            game_state = GameState.objects.select_for_update().filter(room=room).first()
            if game_state:
                frozen = dict(game_state.state_data or {})
                frozen['turnStartedAt'] = None
                game_state.state_data = frozen
                game_state.save(update_fields=['state_data', 'updated_at'])
        _publish_admin_transition(room)
    return presence.get('everBothConnected', False)


def needs_admin_adjudication(room):
    if not _requires_organizer_adjudication(room):
        return False
    return bool(((room.state or {}).get('presence') or {}).get('needsAdminAdjudication'))


def _before_tournament_opening(room, link, game_state):
    return (
        link is not None and link.tournament_id > 0 and game_state is not None
        and (game_state.state_data or {}).get('phase') in ('opening_roll', 'opening_result')
        and not (room.state or {}).get('match', {}).get('games')
    )


def _forfeit_before_opening(room, link, game_state, winner):
    from .link.outbox import enqueue_forfeit

    state = dict(game_state.state_data or {})
    state.update(phase='game_over', winner=winner, winType='single',
                 gameEndReason='forfeit', gameEndPoints=0, turnStartedAt=None)
    room.status = 'cancelled'
    room.white_score = room.target_points if winner == 'white' else 0
    room.black_score = room.target_points if winner == 'black' else 0
    room.save(update_fields=['status', 'white_score', 'black_score', 'updated_at'])
    game_state.state_data = state
    game_state.save(update_fields=['state_data', 'updated_at'])
    enqueue_forfeit(link, room, winner)
    payload = game_ended_payload(state, winner, 'single', 'forfeit', room)
    payload.update(matchOver=True, nextGame=False)
    _entry_event(room.pk, {'type': 'game_ended', 'payload': payload})


def check_room_presence(room_id, now=None):
    """Check a single absence or the game clock when both players are away."""
    now = time.time() if now is None else now
    loser = None
    payload = None
    with transaction.atomic():
        from .scheduling import check_ownership
        room = GameRoom.objects.select_for_update().filter(pk=room_id).first()
        check_ownership(lock=True)
        if not room or room.status not in ('waiting', 'playing'):
            return {'status': 'closed'}
        link = getattr(room, 'tournament_link', None)
        waiting_for_tournament = _waiting_tournament_has_both_seats(room, link)
        if room.status == 'waiting' and not waiting_for_tournament:
            return {'status': 'closed'}
        if (room.state or {}).get('ai'):
            return {'status': 'practice'}
        state, presence = _presence(room)
        requires_organizer = _requires_organizer_adjudication(room)
        previous_needs_admin = bool(presence.get('needsAdminAdjudication'))
        if not requires_organizer and previous_needs_admin:
            presence['needsAdminAdjudication'] = False
            presence['absentSince'] = {}
        if not waiting_for_tournament and not presence.get('everBothConnected'):
            return {'status': 'not_started'}
        game_state = GameState.objects.select_for_update().filter(room=room).first()
        phase = (game_state.state_data or {}).get('phase') if game_state else None
        game_started = phase in ACTIVE_GAME_PHASES
        before_tournament_opening = _before_tournament_opening(room, link, game_state)

        for connection_id, entry in list(presence['connections'].items()):
            if now - float(entry.get('lastSeen', 0)) > STALE_SECONDS:
                presence['connections'].pop(connection_id, None)
                color = entry.get('color')
                presence['absentSince'].setdefault(
                    color, float(entry.get('lastSeen', now)) + STALE_SECONDS
                )

        colors = _colors(presence)
        missing = {'white', 'black'} - colors
        _sync_tournament_pause(room, link, presence, colors, now, game_state)
        opening_pending = presence.get('serverOpeningPending')
        if opening_pending or presence.get('openingBothAbsent'):
            state['presence'] = presence
            room.state = state
            room.save(update_fields=['state', 'updated_at'])
            if previous_needs_admin:
                _publish_admin_transition(room)
            if opening_pending:
                # Keep watching so disconnect rules resume after the first turn starts.
                _schedule(room.pk)
            return {'status': 'waiting', 'missing': sorted(missing)}

        # One returning seat cannot turn a double absence into a forfeit.
        if presence.get('needsAdminAdjudication') and requires_organizer:
            state['presence'] = presence
            room.state = state
            room.save(update_fields=['state', 'updated_at'])
            if not previous_needs_admin:
                _publish_admin_transition(room)
            return {'status': 'admin_required', 'missing': sorted(missing)}
        if waiting_for_tournament and len(missing) != 1:
            presence['absentSince'] = {}
        elif len(missing) == 1:
            presence['needsAdminAdjudication'] = False
            color = next(iter(missing))
            absent_since = presence['absentSince'].setdefault(color, now)
            if not game_started and not before_tournament_opening:
                state['presence'] = presence
                room.state = state
                room.save(update_fields=['state', 'updated_at'])
                return {'status': 'waiting_to_start', 'missing': sorted(missing)}
            if now - float(absent_since) >= ABSENCE_SECONDS:
                loser = color
            else:
                _schedule(room.id, ABSENCE_SECONDS - (now - float(absent_since)))
        elif len(missing) == 2:
            if requires_organizer and not presence.get('timedBothAbsent'):
                presence['needsAdminAdjudication'] = True
            else:
                presence['needsAdminAdjudication'] = False
                presence['absentSince'] = {}
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
            if presence.get('timedBothAbsent'):
                from .tournament_opening import settle_tournament_clock

                stored = game_state.state_data if game_state else {}
                deadline = deadline_for(stored, room.time_control, room.target_points)
                active = active_player(stored)
                now_ms = int(now * 1000)
                exhausted = (active and stored.get('turnStartedAt') is not None
                             and (stored.get('clock') or {}).get(active) == 0)
                if exhausted or (deadline is not None and deadline <= now_ms):
                    return settle_tournament_clock(room, stored, active)
                delay = WATCH_SECONDS if deadline is None else min(WATCH_SECONDS, (deadline - now_ms) / 1000)
                _schedule(room.id, delay)
            elif len(missing) != 1 and (colors or not waiting_for_tournament):
                _schedule(room.id)
            return {'status': 'waiting', 'missing': sorted(missing)}

        # Keep the eligibility decision and finalization under the same room
        # lock so a reconnect cannot race between them.
        winner = 'black' if loser == 'white' else 'white'
        if before_tournament_opening:
            _forfeit_before_opening(room, link, game_state, winner)
            return {'status': 'forfeited', 'loser': loser, 'winner': winner}
        state_data = dict(game_state.state_data or {})
        win_type = forfeit_win_type(state_data, loser, reason='disconnect')
        state_data.update(
            phase='game_over', winner=winner, winType=win_type,
            gameEndReason='disconnect', message=f'{loser} disconnected for 40 seconds',
        )
        match = finalize_room(room, state_data, winner, win_type, 'disconnect')
        if match is None:
            return {'status': 'closed'}
        room.refresh_from_db()
        payload = game_ended_payload(state_data, winner, win_type, 'disconnect', room)
        payload.update(
            matchId=str(match.id), matchOver=True, nextGame=False,
        )

    async_to_sync(get_channel_layer().group_send)(
        f'game_{room_id}', {'type': 'game_ended', 'payload': payload}
    )
    return {'status': 'forfeited', 'loser': loser, 'winner': winner}
