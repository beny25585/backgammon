"""Translate and verify Sage-native bot moves through the Game engine.

Boundary: this module must NOT import bgsage. The analysis service owns
Open Sage search and supplies Sage-native single-die steps; this module
only translates Sage coordinates to Game coordinates and verifies every
move through BackgammonEngine, which remains the final rules authority.
"""

import copy

from .engine import BackgammonEngine


class BotMoveResolutionError(Exception):
    pass


def _game_to_open_sage_board(state, *, player_on_roll):
    """Local pure mapping equivalent to game_state_to_open_sage_board.

    Game: points[0..23] (positive = white, negative = black),
    bar/home {"white": int, "black": int}, white moves 23 -> 0 -> off,
    black moves 0 -> 23 -> off.
    Open Sage (player-on-roll perspective): 26 ints, index 0 =
    opponent bar, 1..24 = points, index 25 = player bar,
    positive = player on roll. Caller must also ensure checker totals
    (points + bar + home == 15 per color); see _require_checker_totals.
    """
    points = state["points"]
    bar = state["bar"]
    board = [0] * 26
    if player_on_roll == "white":
        board[0] = bar["black"]
        for index in range(24):
            board[index + 1] = points[index]
        board[25] = bar["white"]
    else:
        board[0] = bar["white"]
        for index in range(24):
            board[index + 1] = -points[23 - index]
        board[25] = bar["black"]
    return board


def _require_checker_totals(state):
    points = state["points"]
    bar = state["bar"]
    home = state["home"]
    white_on_points = sum(value for value in points if value > 0)
    black_on_points = sum(-value for value in points if value < 0)
    if (
        white_on_points + bar["white"] + home["white"] != 15
        or black_on_points + bar["black"] + home["black"] != 15
    ):
        raise BotMoveResolutionError(
            "Checker totals must be 15 per color "
            "(points + bar + home)."
        )


def _sage_point_to_game_point(sage_point, player_color):
    """Exact inverse of game_state_to_open_sage_board point mapping."""
    if sage_point == 25:
        return "bar"
    if sage_point == 0:
        return "off"
    if player_color == "white":
        return sage_point - 1
    return 24 - sage_point


def _is_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_inputs(state, player_color, sage_moves, target_board):
    if player_color not in ("white", "black"):
        raise BotMoveResolutionError(
            "player_color must be 'white' or 'black', "
            "got %r." % (player_color,)
        )
    if not isinstance(state, dict):
        raise BotMoveResolutionError("state must be a dict.")
    if state.get("phase") != "moving":
        raise BotMoveResolutionError(
            'state["phase"] must be "moving" for a checker-play turn.'
        )
    if state.get("turn") != player_color:
        raise BotMoveResolutionError(
            "Not your turn: state turn does not match player_color."
        )
    try:
        points = state["points"]
        bar = state["bar"]
        home = state["home"]
    except (KeyError, TypeError) as exc:
        raise BotMoveResolutionError(
            "state must contain points/bar/home."
        ) from exc
    if (
        not isinstance(points, list)
        or len(points) != 24
        or any(not _is_int(value) for value in points)
    ):
        raise BotMoveResolutionError('state["points"] must be 24 integers.')
    for label in ("bar", "home"):
        section = state[label]
        if (
            not isinstance(section, dict)
            or not _is_int(section.get("white"))
            or section.get("white") < 0
            or not _is_int(section.get("black"))
            or section.get("black") < 0
        ):
            raise BotMoveResolutionError(
                'state must contain %s {"white": int, "black": int}.'
                % (label,)
            )
    if (
        not isinstance(target_board, list)
        or len(target_board) != 26
        or any(not _is_int(value) for value in target_board)
    ):
        raise BotMoveResolutionError(
            "target_board must be a list of exactly 26 integers."
        )
    if not isinstance(sage_moves, list):
        raise BotMoveResolutionError("sage_moves must be a list of dicts.")
    for move in sage_moves:
        if not isinstance(move, dict):
            raise BotMoveResolutionError(
                "Each sage move must be a dict with from/to/die."
            )
        sage_from = move.get("from")
        sage_to = move.get("to")
        die = move.get("die")
        if not _is_int(sage_from) or not 1 <= sage_from <= 25:
            raise BotMoveResolutionError(
                "Sage move 'from' must be int 1..25, got %r."
                % (sage_from,)
            )
        if not _is_int(sage_to) or not 0 <= sage_to <= 24:
            raise BotMoveResolutionError(
                "Sage move 'to' must be int 0..24, got %r."
                % (sage_to,)
            )
        if not _is_int(die) or not 1 <= die <= 6:
            raise BotMoveResolutionError(
                "Sage move 'die' must be int 1..6, got %r." % (die,)
            )


def _consumed_die(before_remaining, after_remaining):
    """Multiset difference: exactly one die must have been consumed."""
    rest = list(after_remaining)
    consumed = []
    for die in before_remaining:
        if die in rest:
            rest.remove(die)
        else:
            consumed.append(die)
    if rest:
        return None
    return consumed


def resolve_open_sage_moves(
    *,
    state: dict,
    player_color: str,
    sage_moves: list[dict],
    target_board: list[int],
) -> list[dict]:
    """Translate Sage-native steps to verified Game-native moves.

    Verifies every move through BackgammonEngine on a deep copy of the
    input state, checks the engine-consumed die matches the declared die,
    rejects incomplete turns, and requires the final board to equal
    target_board exactly.
    """
    _validate_inputs(state, player_color, sage_moves, target_board)
    _require_checker_totals(state)
    target = list(target_board)

    translated = [
        {
            "from": _sage_point_to_game_point(move["from"], player_color),
            "to": _sage_point_to_game_point(move["to"], player_color),
            "die": move["die"],
        }
        for move in sage_moves
    ]

    cloned = copy.deepcopy(state)
    engine = BackgammonEngine(cloned)
    game_moves = []
    for game_move, sage_move in zip(translated, sage_moves):
        before_remaining = list(engine.state.get("remaining") or [])
        try:
            result = engine.make_move(
                game_move["from"],
                game_move["to"],
                player_color,
            )
        except Exception as exc:
            raise BotMoveResolutionError(
                "Game engine rejected reconstructed move %r: %s"
                % (game_move, exc)
            ) from exc
        if not result.get("success"):
            raise BotMoveResolutionError(
                "Game engine rejected reconstructed move %r: %s"
                % (game_move, result.get("message"))
            )
        after_remaining = list(engine.state.get("remaining") or [])
        consumed = _consumed_die(before_remaining, after_remaining)
        if consumed is None or len(consumed) != 1:
            raise BotMoveResolutionError(
                "Game engine did not consume exactly one die for move %r "
                "(before=%r after=%r)." % (
                    game_move, before_remaining, after_remaining)
            )
        actual_die = consumed[0]
        if actual_die != sage_move["die"]:
            raise BotMoveResolutionError(
                "Declared die %r does not match engine-consumed die %r "
                "for move %r." % (
                    sage_move["die"], actual_die, game_move)
            )
        game_moves.append(
            {
                "from": game_move["from"],
                "to": game_move["to"],
                "die": actual_die,
            }
        )

    if (
        engine.state.get("phase") == "moving"
        and engine.state.get("turn") == player_color
        and engine.all_legal_moves(player_color)
    ):
        raise BotMoveResolutionError(
            "Resolved move sequence stops before all required legal moves "
            "are played."
        )

    _require_checker_totals(engine.state)
    final_board = _game_to_open_sage_board(
        engine.state, player_on_roll=player_color
    )
    if list(final_board) != list(target):
        raise BotMoveResolutionError(
            "Reconstructed moves do not reach target_board on Game engine."
        )

    return game_moves
