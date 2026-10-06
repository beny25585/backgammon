"""Immutable match-analysis payload builder (Game -> Analysis contract).

Builds the exact JSON package expected by the Analysis Service endpoint::

    POST /api/v1/internal/matches/

This module performs no I/O beyond local ORM reads: no HTTP requests,
no task enqueueing, no Open Sage calls.
"""

from collections import defaultdict

from ..link.models import TournamentLink
from ..models import GameEvent, GameState

SCHEMA_VERSION = 1


class AnalysisPayloadError(ValueError):
    pass


def validate_match_history(match, events):
    """Validate the sealed history, independently of client-visible versions."""
    expected = match.history_sequence
    if expected is None:
        raise AnalysisPayloadError(
            f"Match {match.pk} has no verified history boundary; inspect legacy history before delivery."
        )
    mismatch = next(((ordinal, event.history_sequence)
                     for ordinal, event in enumerate(events, 1)
                     if event.history_sequence != ordinal), None)
    if len(events) != expected or mismatch is not None:
        raise AnalysisPayloadError(
            f"Match {match.pk} history is incomplete: expected={expected} stored={len(events)}; "
            f"first mismatch={mismatch or (len(events) + 1, None)}; "
            "history ordinals must be unique and contiguous."
        )
    if not isinstance(match.games, list) or not match.games:
        raise AnalysisPayloadError('Match has no valid game list.')
    game_ids = []
    for game in match.games:
        if not isinstance(game, dict) or not game.get('game_id'):
            raise AnalysisPayloadError('Match has a game without an ID.')
        game_ids.append(str(game['game_id']))
    if len(set(game_ids)) != len(game_ids):
        raise AnalysisPayloadError('Match has duplicate game IDs.')
    known_games = set(game_ids)
    for event in events:
        if not isinstance(event.payload, dict):
            raise AnalysisPayloadError(f'Event {event.pk} has an invalid payload.')
        if event.game_id not in known_games or (
                event.payload.get('gameId') and str(event.payload['gameId']) != event.game_id):
            raise AnalysisPayloadError(f'Event {event.pk} does not belong to a recorded game.')


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
        "max_cube_value": max(2, int(state["maxCube"])) if state.get("maxCube") else 0,
        "jacoby": bool(state.get("jacoby", False)),
        "beaver": False,
    }


def _serialize_event(event, *, ai=False):
    actor = (event.payload or {}).get("actorColor")
    # Historical bot events have no RoomPlayer; system events stay unattributed.
    if actor not in ("white", "black"):
        actor = "black" if ai and event.event_type in {
            "roll", "move", "undo", "end_turn", "double", "double_response",
        } else None
    return {
        "sequence": event.sequence,
        "event_type": event.event_type,
        "player_color": (
            event.player.color
            if event.player_id
            else actor
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


def _games_payload(match, events):
    stored = match.games or []
    ordered = sorted(
        stored, key=lambda game: int(game.get("game_number", 0))
    )
    running_white = 0
    running_black = 0
    games = []
    by_game = defaultdict(list)
    for event in events:
        by_game[event.game_id].append(_serialize_event(event, ai=match.match_type == "ai"))
    for game in ordered:
        game_id = str(game["game_id"])
        game_events = by_game[game_id]

        if "score_before" in game and "score_after" in game:
            if not isinstance(game['score_before'], dict) or not isinstance(game['score_after'], dict):
                raise AnalysisPayloadError(f'Game {game_id} has invalid scores.')
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
            is_crawford = _legacy_crawford_from_events(game_events)

        games.append({
            "game_id": game_id,
            "game_number": int(game["game_number"]),
            "winner": game["winner"],
            "win_type": game["win_type"],
            "points_awarded": int(game["points_awarded"]),
            "score_before": score_before,
            "score_after": score_after,
            "is_crawford": is_crawford,
            "events": game_events,
        })
    return games


def build_match_analysis_payload(match, *, events=None) -> dict:
    """Build the immutable analysis package for a finished Match."""
    room = match.room
    if room is None:
        raise AnalysisPayloadError("Match has no room.")
    if match.white_player_id is None or (match.black_player_id is None and match.match_type != "ai"):
        raise AnalysisPayloadError("Match is missing players.")
    if not match.games:
        raise AnalysisPayloadError("Match has no games.")
    try:
        state = GameState.objects.get(room=room).state_data
    except GameState.DoesNotExist as exc:
        raise AnalysisPayloadError(
            "Final GameState for the room does not exist."
        ) from exc
    if not isinstance(state, dict):
        raise AnalysisPayloadError('Final GameState has an invalid payload.')

    if events is None:
        events = list(GameEvent.objects.filter(room=room).select_related("player").order_by("sequence"))

    return {
        "schema_version": SCHEMA_VERSION,
        "match_id": str(match.id),
        "room_id": str(room.id),
        "source": {"type": "ai", "tournament_id": None, "fixture_id": None} if match.match_type == "ai" else _source_payload(room),
        "players": {
            "white": {"player_id": match.white_player_id, "name": str(match.white_player)},
            "black": {"player_id": None, "name": "Open Sage", "kind": "ai"} if match.match_type == "ai" else {"player_id": match.black_player_id, "name": str(match.black_player)},
        },
        "rules": _rules_payload(match, room, state),
        "result": {
            "winner": match.winner,
            "white_score": int(match.white_score),
            "black_score": int(match.black_score),
        },
        "games": _games_payload(match, events),
    }
