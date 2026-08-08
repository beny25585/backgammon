"""Centralized game-end / room-close service.

Every way a game can end funnels through `finalize_room` so scoring, Match
recording and room closure behave identically regardless of the ending
(bear-off, double-decline, give-up, and any future ending).
"""

import uuid

from django.db import transaction

from .helpers import extract_transcript
from .models import GameRoom, Match

# Multiplier applied per win type before the doubling cube value.
POINTS_MULTIPLIER = {'single': 1, 'gammon': 2, 'backgammon': 3}


def get_room_sync(room_id):
    try:
        return GameRoom.objects.get(id=uuid.UUID(room_id))
    except (GameRoom.DoesNotExist, ValueError):
        return None


def _points_for(state, win_type):
    return POINTS_MULTIPLIER.get(win_type, 1) * int(state.get('cube', 1) or 1)


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

        transcript = extract_transcript(state)
        games_data = [{
            'game_number': 1,
            'winner': winner,
            'win_type': win_type,
            'points_awarded': points,
            'transcript': transcript,
        }]

        return Match.objects.create(
            room=locked,
            match_type='online',
            target_points=locked.target_points,
            white_score=locked.white_score,
            black_score=locked.black_score,
            winner=winner,
            games=games_data,
        )


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
        transcript = extract_transcript(state)
        games.append({
            'game_number': len(games) + 1,
            'winner': winner,
            'win_type': win_type,
            'points_awarded': points,
            'transcript': transcript,
        })
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
            result['match'] = Match.objects.create(
                room=locked,
                match_type='online',
                target_points=locked.target_points,
                white_score=locked.white_score,
                black_score=locked.black_score,
                winner=winner,
                games=games,
            )
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
