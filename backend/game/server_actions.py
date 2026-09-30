"""Reusable server-side game-action orchestration.

Shared pipeline used after a game-engine action, so that BOTH the player
WebSocket flow (GameConsumer) and the future Bot Driver produce the same
persistence, sequencing, clock, game-end, event, broadcast and snapshot
behavior.

Transport-specific effects are delivered through explicit async callbacks,
so this module never touches a GameConsumer instance, channel layers, or
socket timers. No bot-specific code lives here.
"""

import asyncio
import copy
import logging
import time as time_module

from channels.db import database_sync_to_async
from django.db import transaction
from django.utils import timezone

from .clock import compute_clock
from .inactivity import ensure_inactivity_check, refresh_after_action
from .link.live import publish_snapshot
from .models import GameEvent, GameRoom, GameState, RoomPlayer

logger = logging.getLogger(__name__)

# Keep strong references until background persistence finishes.
_background_tasks: set[asyncio.Task] = set()


def run_in_background(coroutine):
    task = asyncio.create_task(coroutine)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def event_game_id(payload):
    """Extract the game ID from a persisted state-snapshot payload.

    The authoritative value is the state snapshot stored in the event
    payload. The "initial" fallback exists only for legacy persisted
    rooms that predate real game IDs.
    """
    if isinstance(payload, dict):
        value = payload.get('gameId')
        if value:
            return str(value)
    return 'initial'


@database_sync_to_async
def persist_state_and_advance(room_id, state):
    """Persist the authoritative state with one serialized room transaction."""
    with transaction.atomic():
        room = GameRoom.objects.select_for_update().get(id=room_id)
        room.last_sequence += 1
        room.save(update_fields=['last_sequence'])
        sequence = room.last_sequence
        state['version'] = sequence
        GameState.objects.filter(room_id=room_id).update(
            state_data=state,
            updated_at=timezone.now(),
        )
    return sequence


@database_sync_to_async
def record_event(room_id, player_color, event_type, payload, sequence):
    player_id = None
    if player_color:
        player_id = (
            RoomPlayer.objects.filter(room_id=room_id, color=player_color)
            .values_list('id', flat=True)
            .first()
        )
    GameEvent.objects.create(
        room_id=room_id,
        player_id=player_id,
        game_id=event_game_id(payload),
        sequence=sequence,
        event_type=event_type,
        payload={**payload, "actorColor": player_color},
    )


async def record_event_safely(room_id, player_color, event_type, payload, sequence):
    try:
        await record_event(room_id, player_color, event_type, payload, sequence)
    except Exception:
        logger.exception(
            "Background event persistence failed: room=%s action=%s sequence=%s",
            room_id,
            event_type,
            sequence,
        )


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

    Returns {"outcome": "timeout" | "game_over" | "state_update",
    "sequence": int, "state": new_state}.
    """
    # Server-owned clock: recompute from our wall clock, never trust the client.
    now_ms = int(time_module.time() * 1000)
    clock, turn_started_at, new_active, timed_out, _deadline = compute_clock(
        stored_state, new_state, now_ms, room.time_control,
        room.target_points,
    )
    if clock is not None:
        new_state['clock'] = clock
        new_state['turnStartedAt'] = turn_started_at

    if timed_out and new_active:
        sequence = await persist_state_and_advance(room.id, new_state)
        new_state['version'] = sequence
        await record_event(
            room.id,
            player_color,
            action,
            copy.deepcopy(new_state),
            sequence,
        )
        winner = 'black' if new_active == 'white' else 'white'
        await on_timeout(winner, new_active)
        return {'outcome': 'timeout', 'sequence': sequence,
                'state': new_state}

    # Independent anti-stall tracking: every successful engine action resets
    # the responsible player's inactivity window from the NEW state. Rejected
    # actions never reach this pipeline; reconnects and heartbeats bypass it.
    if refresh_after_action(new_state, now_ms) is not None:
        await database_sync_to_async(ensure_inactivity_check)(room.id)

    sequence = await persist_state_and_advance(room.id, new_state)
    new_state['version'] = sequence

    if clock is not None and new_active:
        await on_reschedule_timeout()

    # Opening result is only shown briefly; then the winner plays the two
    # dice that decided the opening roll.
    if new_state.get('phase') == 'opening_result':
        await on_opening_result()

    # Centralized game-end: any game_over state the engine reports finalizes
    # the room (idempotent) and broadcasts game_ended to everyone.
    if new_state.get('phase') == 'game_over' and new_state.get('winner'):
        await record_event(
            room.id,
            player_color,
            action,
            copy.deepcopy(new_state),
            sequence,
        )
        await on_game_over(
            new_state,
            new_state['winner'],
            new_state.get('winType', 'single'),
            action,
        )
        return {'outcome': 'game_over', 'sequence': sequence,
                'state': new_state}

    run_in_background(record_event_safely(
        room.id,
        player_color,
        action,
        copy.deepcopy(new_state),
        sequence,
    ))
    await on_state_update(
        state=new_state,
        player_color=player_color,
        action=action,
    )
    turn_notice = (result or {}).get('turn_notice')
    if turn_notice:
        await on_turn_notice(
            turn_notice=turn_notice,
            player_color=player_color,
        )
    asyncio.create_task(database_sync_to_async(
        publish_snapshot)(room.id, new_state))
    return {'outcome': 'state_update', 'sequence': sequence,
            'state': new_state}
