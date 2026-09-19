"""Immutable match-analysis payload builder (Game -> Analysis contract).

Builds the exact JSON package expected by the Analysis Service endpoint::

    POST /api/v1/internal/matches/

This module performs no I/O beyond local ORM reads: no HTTP requests,
no task enqueueing, no Open Sage calls.
"""

from .link.models import TournamentLink
from .models import GameEvent, GameState

SCHEMA_VERSION = 1


class AnalysisPayloadError(ValueError):
    pass


def _source_payload(room):
    """Centralized TournamentLink sentinel interpretation."""
    link = TournamentLink.objects.filter(room=room).first()
    if link is None:
        return {
            "type": "private",
            "tournament_id": None,
            "fixture_id": None,
        }
    if link.tournament_id != 0:
        return {
            "type": "tournament",
            "tournament_id": link.tournament_id,
            "fixture_id": link.fixture_id,
        }
    return {
        "type": "quick",
        "tournament_id": None,
        "fixture_id": link.fixture_id,
    }


def _rules_payload(match, room, state):
    game_format = state.get("gameFormat") or "match"
    return {
        "format": game_format,
        "target_points": int(match.target_points),
        "time_control": room.time_control,
        "doubling_enabled": bool(
            state.get(
                "doublingAllowed",
                state.get("doublingEnabled", True),
            )
        ),
        "max_cube_value": int(state.get("maxCube") or 0),
        "jacoby": bool(state.get("jacoby", False)),
        "beaver": False,
    }


def _serialize_event(event):
    return {
        "sequence": event.sequence,
        "event_type": event.event_type,
        "player_color": (
            event.player.color
            if event.player_id
            else None
        ),
        "payload": event.payload or {},
        "created_at": event.created_at.isoformat(),
    }


def _legacy_crawford_from_events(events):
    for event in events:
        payload = event.get("payload") or {}
        if isinstance(payload, dict) and "crawfordGame" in payload:
            return bool(payload["crawfordGame"])
    return False


def _games_payload(match, room):
    stored = match.games or []
    ordered = sorted(
        stored, key=lambda game: int(game.get("game_number", 0))
    )
    running_white = 0
    running_black = 0
    games = []
    for game in ordered:
        game_id = str(game["game_id"])
        events = [
            _serialize_event(event)
            for event in GameEvent.objects.filter(
                room=room,
                game_id=game_id,
            ).select_related("player").order_by("sequence")
        ]

        if "score_before" in game and "score_after" in game:
            score_before = {
                "white": int(game["score_before"].get("white", 0)),
                "black": int(game["score_before"].get("black", 0)),
            }
            score_after = {
                "white": int(game["score_after"].get("white", 0)),
                "black": int(game["score_after"].get("black", 0)),
            }
            running_white = score_after["white"]
            running_black = score_after["black"]
        else:
            score_before = {
                "white": running_white,
                "black": running_black,
            }
            if game.get("winner") == "white":
                running_white += int(game.get("points_awarded", 0) or 0)
            elif game.get("winner") == "black":
                running_black += int(game.get("points_awarded", 0) or 0)
            score_after = {
                "white": running_white,
                "black": running_black,
            }

        if "is_crawford" in game:
            is_crawford = bool(game["is_crawford"])
        else:
            is_crawford = _legacy_crawford_from_events(events)

        games.append({
            "game_id": game_id,
            "game_number": int(game["game_number"]),
            "winner": game["winner"],
            "win_type": game["win_type"],
            "points_awarded": int(game["points_awarded"]),
            "score_before": score_before,
            "score_after": score_after,
            "is_crawford": is_crawford,
            "events": events,
        })
    return games


def build_match_analysis_payload(match) -> dict:
    """Build the immutable analysis package for a finished Match."""
    room = match.room
    if room is None:
        raise AnalysisPayloadError("Match has no room.")
    if match.white_player_id is None or match.black_player_id is None:
        raise AnalysisPayloadError("Match is missing players.")
    if not match.games:
        raise AnalysisPayloadError("Match has no games.")
    try:
        state = GameState.objects.get(room=room).state_data or {}
    except GameState.DoesNotExist as exc:
        raise AnalysisPayloadError(
            "Final GameState for the room does not exist."
        ) from exc

    return {
        "schema_version": SCHEMA_VERSION,
        "match_id": str(match.id),
        "room_id": str(room.id),
        "source": _source_payload(room),
        "players": {
            "white": {"player_id": match.white_player_id},
            "black": {"player_id": match.black_player_id},
        },
        "rules": _rules_payload(match, room, state),
        "result": {
            "winner": match.winner,
            "white_score": int(match.white_score),
            "black_score": int(match.black_score),
        },
        "games": _games_payload(match, room),
    }
