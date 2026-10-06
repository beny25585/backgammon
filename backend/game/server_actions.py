"""Reusable server-side game-action orchestration.

Shared pipeline used after a game-engine action, so that BOTH the player
WebSocket flow (GameConsumer) and the future Bot Driver produce the same
persistence, sequencing, clock, game-end, event and broadcast
behavior.

Transport-specific effects are delivered through explicit async callbacks,
so this module never touches a GameConsumer instance, channel layers, or
socket timers. No bot-specific code lives here.
"""

import asyncio
import logging
import time as time_module

from .clock import active_player, apply_transition, compute_clock, parse_time_control
from .db_timing import measured_database_sync_to_async
from .event_history import persist_game_action
from .inactivity import refresh_after_action

logger = logging.getLogger(__name__)

# Log a warning when the post-engine action pipeline itself is slow.
SLOW_ACTION_WARNING_MS = 250

SLOW_GAME_ACTION_MS = 250

# Keep strong references to bot work until it finishes.
_background_tasks: set[asyncio.Task] = set()


def _elapsed_ms(started_at: float) -> int:
    return int((time_module.perf_counter() - started_at) * 1000)


def run_in_background(coroutine):
    task = asyncio.create_task(coroutine)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


@measured_database_sync_to_async
def persist_state_and_advance(room_id, state, player_color, event_type):
    return persist_game_action(room_id, state, player_color, event_type)


async def apply_server_game_action(
    *,
    room,
    stored_state: dict,
    new_state: dict,
    player_color,
    action: str,
    result: dict,
    on_timeout,
    on_reschedule_timeout,
    on_opening_result,
    on_game_over,
    on_state_update,
    on_turn_notice,
) -> dict:
    """Run the shared post-action pipeline for one engine action.

    Important:
    - The engine action has ALREADY happened before this function is called.
      Timing here therefore measures only the post-engine pipeline.
    - State and history commit together before the state is broadcast.
    - Analysis HTTP delivery belongs to the existing task worker.
    - On end_turn, the next player's turnStartedAt is reset immediately before
      persistence so server-side processing does not consume their free delay.

    Returns:
        {
            "outcome": "timeout" | "game_over" | "state_update",
            "sequence": int,
            "state": new_state,
        }
    """
    perf_started = time_module.perf_counter()
    pipeline_started_ms = int(time_module.time() * 1000)
    now_ms = pipeline_started_ms

    timings = {
        "clock_ms": 0,
        "inactivity_refresh_ms": 0,
        "inactivity_schedule_ms": 0,
        "confirm_pause_ms": 0,
        "persist_ms": 0,
        "opening_result_ms": 0,
        "broadcast_ms": 0,
        "timeout_reschedule_ms": 0,
        "turn_notice_ms": 0,
        "game_over_callback_ms": 0,
    }

    previous_active = active_player(stored_state)

    is_final_move = (
        action == "move"
        and (result or {}).get("success")
        and new_state.get("phase") == "moving"
        and len(new_state.get("remaining") or []) == 0
    )

    move_history = new_state.get("moveHistory")
    move_history_len = len(move_history) if isinstance(
        move_history, list) else 0

    def log_timing(outcome: str, sequence=None):
        total_ms = _elapsed_ms(perf_started)

        if total_ms < SLOW_GAME_ACTION_MS:
            logger.debug(
                "GAME_ACTION_TIMING "
                "room=%s action=%s outcome=%s sequence=%s "
                "player=%s total_ms=%s persist_ms=%s broadcast_ms=%s",
                room.id,
                action,
                outcome,
                sequence,
                player_color,
                total_ms,
                timings["persist_ms"],
                timings["broadcast_ms"],
            )
            return

        logger.warning(
            "SLOW_GAME_ACTION "
            "room=%s action=%s outcome=%s sequence=%s "
            "player=%s total_ms=%s "
            "persist_ms=%s broadcast_ms=%s "
            "timeout_reschedule_ms=%s inactivity_schedule_ms=%s "
            "game_over_callback_ms=%s",
            room.id,
            action,
            outcome,
            sequence,
            player_color,
            total_ms,
            timings["persist_ms"],
            timings["broadcast_ms"],
            timings["timeout_reschedule_ms"],
            timings["inactivity_schedule_ms"],
            timings["game_over_callback_ms"],
        )

    if is_final_move:
        logger.debug(
            "FINAL_MOVE_PIPELINE_START "
            "room=%s player=%s turn=%s phase=%s remaining=%s "
            "move_history_len=%s",
            room.id,
            player_color,
            new_state.get("turn"),
            new_state.get("phase"),
            len(new_state.get("remaining") or []),
            move_history_len,
        )

    if action == "end_turn":
        logger.debug(
            "TURN_HANDOFF_START "
            "room=%s actor=%s stored_turn=%s stored_phase=%s "
            "previous_active=%s new_turn=%s new_phase=%s "
            "stored_turn_started_at=%s",
            room.id,
            player_color,
            stored_state.get("turn"),
            stored_state.get("phase"),
            previous_active,
            new_state.get("turn"),
            new_state.get("phase"),
            stored_state.get("turnStartedAt"),
        )

    # 1. Server-authoritative clock
    clock_started = time_module.perf_counter()

    clock, turn_started_at, new_active, timed_out, _deadline = compute_clock(
        stored_state,
        new_state,
        now_ms,
        room.time_control,
        room.target_points,
    )

    timings["clock_ms"] = _elapsed_ms(clock_started)

    if clock is not None:
        new_state["clock"] = clock
        new_state["turnStartedAt"] = turn_started_at

    if action == "end_turn":
        logger.debug(
            "TURN_HANDOFF_CLOCK_COMPUTED "
            "room=%s from=%s to=%s turn_started_at=%s "
            "timed_out=%s white_clock=%s black_clock=%s clock_ms=%s",
            room.id,
            previous_active,
            new_active,
            turn_started_at,
            timed_out,
            clock.get("white") if clock else None,
            clock.get("black") if clock else None,
            timings["clock_ms"],
        )

    # 2. Immediate timeout path
    if timed_out and new_active:
        logger.warning(
            "GAME_CLOCK_TIMEOUT room=%s action=%s active=%s actor=%s",
            room.id,
            action,
            new_active,
            player_color,
        )

        persist_started = time_module.perf_counter()
        sequence = await persist_state_and_advance(room.id, new_state, player_color, action)
        timings["persist_ms"] = _elapsed_ms(persist_started)
        new_state["version"] = sequence

        winner = "black" if new_active == "white" else "white"

        timeout_callback_started = time_module.perf_counter()
        await on_timeout(winner, new_active)
        timings["game_over_callback_ms"] = _elapsed_ms(
            timeout_callback_started)

        log_timing("timeout", sequence)

        return {
            "outcome": "timeout",
            "sequence": sequence,
            "state": new_state,
        }

    # 3. Inactivity / anti-stall tracking
    inactivity_refresh_started = time_module.perf_counter()

    inactivity_refreshed = refresh_after_action(
        new_state,
        now_ms,
    )

    timings["inactivity_refresh_ms"] = _elapsed_ms(
        inactivity_refresh_started
    )

    # A persistent room check reads this committed timestamp when it wakes.
    # Opening/reconnect arms it; the watchdog repairs a missing task. No queue
    # lookup or scheduling round trip is needed on each accepted action.

    # 4. Pause clock while waiting for Confirm / Undo after final move
    confirm_pause_started = time_module.perf_counter()

    if (
        action == "move"
        and (result or {}).get("success")
        and clock is not None
        and new_state.get("phase") == "moving"
        and new_state.get("turn") == player_color
        and stored_state.get("turn") == new_state.get("turn")
        and not new_state.get("winner")
        and len(new_state.get("remaining") or []) == 0
    ):
        stored_turn_started_at = stored_state.get("turnStartedAt")

        if stored_turn_started_at is None:
            new_state["turnStartedAt"] = None
        else:
            tc = parse_time_control(
                room.time_control,
                room.target_points,
            )

            if tc is not None:
                _, delay_ms = tc
                elapsed_ms = max(
                    0,
                    now_ms - stored_turn_started_at,
                )

                new_state["clock"] = apply_transition(
                    clock,
                    player_color,
                    None,
                    elapsed_ms,
                    delay_ms,
                )

            new_state["turnStartedAt"] = None

        logger.debug(
            "CONFIRM_CLOCK_PAUSED "
            "room=%s player=%s white_clock=%s black_clock=%s",
            room.id,
            player_color,
            (new_state.get("clock") or {}).get("white"),
            (new_state.get("clock") or {}).get("black"),
        )

    timings["confirm_pause_ms"] = _elapsed_ms(confirm_pause_started)

    # 5. Turn handoff fairness
    is_turn_handoff = (
        action == "end_turn"
        and clock is not None
        and previous_active is not None
        and new_active is not None
        and previous_active != new_active
    )

    if is_turn_handoff:
        # Use epoch milliseconds here because turnStartedAt is persisted and is
        # later used by deadline calculations.
        handoff_ms = int(time_module.time() * 1000)
        new_state["turnStartedAt"] = handoff_ms

        logger.debug(
            "TURN_HANDOFF_CLOCK_RESET "
            "room=%s from=%s to=%s "
            "server_processing_before_handoff_ms=%s turn_started_at=%s",
            room.id,
            previous_active,
            new_active,
            handoff_ms - pipeline_started_ms,
            handoff_ms,
        )

    # 6. Authoritative persistence
    persist_started = time_module.perf_counter()

    sequence = await persist_state_and_advance(
        room.id,
        new_state,
        player_color,
        action,
    )

    timings["persist_ms"] = _elapsed_ms(persist_started)
    new_state["version"] = sequence

    if is_turn_handoff:
        logger.debug(
            "TURN_HANDOFF_PERSISTED "
            "room=%s sequence=%s persist_ms=%s "
            "total_pipeline_ms=%s",
            room.id,
            sequence,
            timings["persist_ms"],
            int(time_module.time() * 1000) - pipeline_started_ms,
        )

    # 7. Opening result timer
    if new_state.get("phase") == "opening_result":
        opening_result_started = time_module.perf_counter()
        await on_opening_result()
        timings["opening_result_ms"] = _elapsed_ms(
            opening_result_started
        )

    # 8. Centralized game-over path
    if (
        new_state.get("phase") == "game_over"
        and new_state.get("winner")
    ):
        game_over_started = time_module.perf_counter()

        await on_game_over(
            new_state,
            new_state["winner"],
            new_state.get("winType", "single"),
            action,
        )

        timings["game_over_callback_ms"] = _elapsed_ms(
            game_over_started
        )

        log_timing("game_over", sequence)

        return {
            "outcome": "game_over",
            "sequence": sequence,
            "state": new_state,
        }

    # 9. Broadcast the committed state
    broadcast_wall_started_ms = int(time_module.time() * 1000)

    if is_turn_handoff:
        logger.debug(
            "TURN_HANDOFF_BROADCAST_START "
            "room=%s from=%s to=%s version=%s "
            "ms_since_handoff=%s",
            room.id,
            previous_active,
            new_active,
            sequence,
            broadcast_wall_started_ms - new_state["turnStartedAt"],
        )

    broadcast_started = time_module.perf_counter()

    try:
        await on_state_update(
            state=new_state,
            player_color=player_color,
            action=action,
        )
    finally:
        timings["broadcast_ms"] = _elapsed_ms(
            broadcast_started
        )

    if is_turn_handoff:
        logger.debug(
            "TURN_HANDOFF_BROADCAST_QUEUED "
            "room=%s to=%s broadcast_ms=%s "
            "total_pipeline_ms=%s",
            room.id,
            new_active,
            timings["broadcast_ms"],
            int(time_module.time() * 1000) - pipeline_started_ms,
        )

    # 10. Reschedule authoritative clock timeout AFTER broadcast
    if clock is not None and new_active:
        timeout_started = time_module.perf_counter()

        await on_reschedule_timeout(new_state)

        timings["timeout_reschedule_ms"] = _elapsed_ms(
            timeout_started
        )

        if is_turn_handoff:
            logger.debug(
                "TURN_HANDOFF_TIMEOUT_RESCHEDULED "
                "room=%s active=%s reschedule_ms=%s "
                "total_pipeline_ms=%s",
                room.id,
                new_active,
                timings["timeout_reschedule_ms"],
                int(time_module.time() * 1000) - pipeline_started_ms,
            )

    # 11. Optional turn notice
    turn_notice = (result or {}).get("turn_notice")

    if turn_notice:
        turn_notice_started = time_module.perf_counter()

        await on_turn_notice(
            turn_notice=turn_notice,
            player_color=player_color,
        )

        timings["turn_notice_ms"] = _elapsed_ms(
            turn_notice_started
        )


    # 12. One summary line per successful action
    log_timing("state_update", sequence)

    return {
        "outcome": "state_update",
        "sequence": sequence,
        "state": new_state,
    }
