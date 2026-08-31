"""Centralized game-end / room-close service.

Every way a game can end funnels through `finalize_room` so scoring, Match
recording and room closure behave identically regardless of the ending
(bear-off, double-decline, give-up, and any future ending).

A room belonging to an external tournament also reports its outcome from
here, for the same reason: every ending has to be reported, so the hook
belongs where every ending already passes.
"""

import uuid

from django.db import transaction

from .link.models import TournamentLink
from .link.outbox import enqueue_result
from .models import GameEvent, GameRoom, Match, RoomPlayer

# Multiplier applied per win type before the doubling cube value.
POINTS_MULTIPLIER = {'single': 1, 'gammon': 2, 'backgammon': 3}


def get_room_sync(room_id):
    try:
        return GameRoom.objects.get(id=uuid.UUID(room_id))
    except (GameRoom.DoesNotExist, ValueError):
        return None


def _room_players(room):
    """Return (white_player, black_player) for a room, or (None, None)."""
    white_rp = room.players.filter(color='white').first()
    black_rp = room.players.filter(color='black').first()
    return (
        white_rp.player if white_rp else None,
        black_rp.player if black_rp else None,
    )


def _points_for(state, win_type):
    return POINTS_MULTIPLIER.get(win_type, 1) * int(state.get('cube', 1) or 1)


def _transcript_from_events(events):
    """Build a turn-based transcript from a room's GameEvent log.

    Each 'move' event's payload carries the accumulated `lastMove` for the
    current turn, so later move events in a turn supersede earlier ones. Rolls
    start a new turn. This reconstructs the play-by-play without relying on the
    transient `state.moveHistory` (an undo stack that gets cleared every turn).
    """
    transcript = []
    current = None
    for event in events:
        payload = event.payload or {}
        if event.event_type == 'roll':
            if current:
                transcript.append(current)
            current = {
                'turn': payload.get('turn'),
                'roll': list(payload.get('dice', [])),
                'moves': [],
            }
        elif event.event_type == 'move':
            if current is None:
                current = {
                    'turn': payload.get('turn'),
                    'roll': [],
                    'moves': [],
                }
            moves = payload.get('lastMove')
            if isinstance(moves, list):
                current['moves'] = [dict(m) for m in moves if isinstance(m, dict)]
        elif event.event_type in ('end_turn', 'next_game', 'opening_result_done'):
            if current:
                transcript.append(current)
                current = None
    if current:
        transcript.append(current)
    return transcript


def _hits_from_events(events):
    """Count captures (hits) by watching an opponent checker land on the bar."""
    hits = 0
    prev_state = None
    for event in events:
        payload = event.payload or {}
        if event.event_type != 'move':
            continue
        if prev_state is None:
            prev_state = payload
            continue
        mover = payload.get('turn')
        opp = 'black' if mover == 'white' else 'white'
        prev_bar = (prev_state.get('bar') or {}).get(opp, 0)
        cur_bar = (payload.get('bar') or {}).get(opp, 0)
        if cur_bar > prev_bar:
            hits += 1
        prev_state = payload
    return hits


def _doubles_from_events(events):
    offered = 0
    accepted = 0
    for event in events:
        if event.event_type == 'double':
            offered += 1
        elif event.event_type == 'double_response':
            payload = event.payload or {}
            if payload.get('phase') != 'game_over':
                accepted += 1
    return offered, accepted


def _match_metadata(room, state, reason):
    """Derive saved Match metadata from the room's GameEvent log and final state."""
    events = list(GameEvent.objects.filter(room=room).order_by('sequence'))
    transcript = _transcript_from_events(events)
    hits = _hits_from_events(events)
    doubles_offered, doubles_accepted = _doubles_from_events(events)

    duration_seconds = None
    if events:
        span = (events[-1].created_at - events[0].created_at).total_seconds()
        duration_seconds = max(0, int(span))

    opening_roll = state.get('openingRoll')
    first_player = None
    if isinstance(opening_roll, dict) and opening_roll.get('white') and opening_roll.get('black'):
        first_player = 'white' if opening_roll['white'] > opening_roll['black'] else 'black'

    return {
        'end_reason': reason,
        'first_player': first_player,
        'opening_roll': opening_roll,
        'final_cube': int(state.get('cube', 1) or 1),
        'hits': hits,
        'doubles_offered': doubles_offered,
        'doubles_accepted': doubles_accepted,
        'clock_remaining': state.get('clock'),
        'duration_seconds': duration_seconds,
    }, transcript


def _pips_for(state, color):
    """Pips remaining for `color` in the final board state."""
    points = state.get('points') or []
    bar = (state.get('bar') or {})
    if color == 'white':
        total = sum(max(0, c) * (24 - i) for i, c in enumerate(points))
        return total + bar.get('white', 0) * 25
    total = sum(max(0, -c) * (i + 1) for i, c in enumerate(points))
    return total + bar.get('black', 0) * 25


def _game_entry(state, winner, win_type, points, game_number, transcript):
    """Build one game entry, enriching it with end-of-game board stats."""
    entry = {
        'game_number': game_number,
        'winner': winner,
        'win_type': win_type,
        'points_awarded': points,
        'transcript': transcript,
    }
    loser = 'black' if winner == 'white' else 'white'
    entry['pips_remaining'] = _pips_for(state, loser)
    entry['checkers_on_bar'] = int((state.get('bar') or {}).get(loser, 0))
    entry['final_cube'] = int(state.get('cube', 1) or 1)
    return entry


def _report_to_tournament(room, match, winner):
    """Queue this room's result for the tournament it belongs to, if it belongs to one.

    Called inside the caller's `transaction.atomic()`, so an ending that rolls back never
    leaves a queued result behind. An ordinary room has no link and this is one query.
    """
    link = TournamentLink.objects.filter(room=room).first()
    if link is None:
        return
    enqueue_result(link, match, room, 'completed', winner_color=winner)


def finalize_room(room, state, winner, win_type, reason):
    """Score the finished game, save a Match, and close the room.

    Idempotent: once the room is completed/cancelled, later calls are no-ops.
    Returns the created Match, or None if the room was already finalized.
    """
    with transaction.atomic():
        locked = GameRoom.objects.select_for_update().get(pk=room.pk)
        if locked.status in ('completed', 'cancelled'):
            return None

        points = _points_for(state, win_type)
        if winner == 'white':
            locked.white_score += points
        elif winner == 'black':
            locked.black_score += points
        locked.status = 'completed'
        locked.save()

        metadata, transcript = _match_metadata(locked, state, reason)
        games_data = [_game_entry(state, winner, win_type, points, 1, transcript)]
        white_player, black_player = _room_players(locked)

        match = Match.objects.create(
            room=locked,
            match_type='online',
            target_points=locked.target_points,
            white_score=locked.white_score,
            black_score=locked.black_score,
            winner=winner,
            white_player=white_player,
            black_player=black_player,
            games=games_data,
            **metadata,
        )
        _report_to_tournament(locked, match, winner)
        return match


def record_game_end(room, state, winner, win_type, reason):
    """Score a finished game and either close the room or keep it open.

    A match is played to `room.target_points`: each finished game is scored
    and recorded in `room.state['match']['games']`. Once a player reaches the
    target, the room is completed and a Match is persisted. Otherwise the room
    stays 'playing' so the players can start the next game.

    Idempotent: once the room is completed/cancelled, later calls are no-ops.
    Returns a dict with `match_over`, `points`, scores and target, or None if
    the room was already finalized.
    """
    with transaction.atomic():
        locked = GameRoom.objects.select_for_update().get(pk=room.pk)
        if locked.status in ('completed', 'cancelled'):
            return None

        points = _points_for(state, win_type)
        if winner == 'white':
            locked.white_score += points
        elif winner == 'black':
            locked.black_score += points

        meta = dict(locked.state or {})
        match = meta.get('match') if isinstance(meta.get('match'), dict) else {}
        games = list(match.get('games', []))
        transcript = _transcript_from_events(
            list(GameEvent.objects.filter(room=locked).order_by('sequence'))
        )
        games.append(_game_entry(state, winner, win_type, points, len(games) + 1, transcript))
        meta['match'] = {'active': True, 'games': games}
        locked.state = meta

        winner_score = locked.white_score if winner == 'white' else locked.black_score
        match_over = winner_score >= locked.target_points
        result = {
            'match_over': match_over,
            'match': None,
            'points': points,
            'white_score': locked.white_score,
            'black_score': locked.black_score,
            'target_points': locked.target_points,
        }

        if match_over:
            locked.status = 'completed'
            locked.save()
            white_player, black_player = _room_players(locked)
            metadata, _ = _match_metadata(locked, state, reason)
            result['match'] = Match.objects.create(
                room=locked,
                match_type='online',
                target_points=locked.target_points,
                white_score=locked.white_score,
                black_score=locked.black_score,
                winner=winner,
                white_player=white_player,
                black_player=black_player,
                games=games,
                **metadata,
            )
            # Only the end of the *match* is a fixture result. Individual games inside a
            # longer match end here too and must not be reported.
            _report_to_tournament(locked, result['match'], winner)
        else:
            locked.save()
        return result


def game_ended_payload(state, winner, win_type, reason, room):
    """Build the game_ended broadcast payload sent to the room."""
    cube = int(state.get('cube', 1) or 1)
    return {
        'winner': winner,
        'loser': 'black' if winner == 'white' else 'white',
        'winType': win_type,
        'reason': reason,
        'points': POINTS_MULTIPLIER.get(win_type, 1) * cube,
        'cube': cube,
        'whiteScore': room.white_score,
        'blackScore': room.black_score,
        'targetPoints': room.target_points,
    }
