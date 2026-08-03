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


def finalize_room(room, state, winner, win_type, reason):
    """Score the finished game, save a Match, and close the room.

    Idempotent: once the room is completed/cancelled, later calls are no-ops.
    Returns the created Match, or None if the room was already finalized.
    """
    with transaction.atomic():
        locked = GameRoom.objects.select_for_update().get(pk=room.pk)
        if locked.status in ('completed', 'cancelled'):
            return None

        points = POINTS_MULTIPLIER.get(win_type, 1) * int(state.get('cube', 1) or 1)
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
