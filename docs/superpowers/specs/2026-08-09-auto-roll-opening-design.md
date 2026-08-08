# Auto-Roll the Opening Die After 30s + Visible Countdown

Date: 2026-08-09

## Problem

During the opening roll (`opening_roll` phase), the game waits for the player whose turn it is to tap `{action: 'roll'}`. If that player walks away, disconnects, or simply never taps, the game stalls indefinitely at the opening. The clock is deliberately stopped during the opening (`clock.py` returns stopped for `opening_roll`), so the normal time-control forfeit cannot rescue the game.

We want the game to keep running regardless of connection state. If a player does not roll the opening die within 30 seconds, the server should roll for them, and the client should show the player how many seconds remain before that happens.

## Scope

- Applies ONLY to the opening roll (`opening_roll` phase). Normal turn rolls (`rolling` phase) keep relying on the clock/time control (or no timeout if none is set).
- Server-authoritative: the 30s timer is owned by the server, per-room, and survives disconnects. The client countdown is display-only.
- Both the auto-roll and the countdown are part of this change.

## Design

### Server-side (backend/game/consumers.py)

New per-room timer structures, mirroring the existing auto-next-game mechanism:

- `GameConsumer.OPENING_ROLL_DELAY = 30.0`
- Module-level `_opening_auto_roll_tasks: dict` keyed by `room_group_name`
- Module-level `_opening_auto_roll_deadlines: dict` keyed by `room_group_name` (epoch ms)

New methods on `GameConsumer`:

- `_maybe_arm_opening_auto_roll(state)` — if `state.phase == 'opening_roll'` and `state.turn` is set, (re)arm the room's watch task and record its deadline.
- `_opening_auto_roll_watch(delay)` — sleeps `OPENING_ROLL_DELAY`, then if the room is still `playing`, phase is still `opening_roll`, and `state.openingRoll[state.turn] is None`, auto-roll for the current turn player via `_roll_opening_for`. If the resulting state is still `opening_roll` (handover to the other player, or a tie-reset), re-arm. Always clean up the task/deadline in `finally`.
- `_roll_opening_for(color)` — shared helper: fetch dice from the trusted dice service if no `openingDice` seed is cached, call `engine.roll_opening_die(color, die)`, record the event + bump sequence, save state, and broadcast the `state_update` to the room. Reused by both the player-tap path (`_handle_roll_intent`) and the auto-roll path (DRY).
- `_remaining_opening_roll_seconds()` — whole seconds left before the auto-roll, used to populate the countdown sent to clients.

Arming points:

- `connect()` — when a returning player lands in an `opening_roll` state, re-arm the room timer (so a reconnect does not strand the room).
- `_handle_intent` — before the final broadcast, call `_maybe_arm_opening_auto_roll` so a manual roll that hands over to the other player, a tie-reset, or a `next_game` intent re-arms the timer.
- `_start_next_game` — auto-started games begin in `opening_roll`; arm the timer when broadcasting the new game.

Countdown broadcast: the `state_update` envelope carries `openingRollIn` (whole seconds remaining) whenever phase is `opening_roll`. Populated at the broadcast sites in `connect()`, `_handle_intent`, and `_start_next_game` (and the auto-roll watch).

### Client-side (frontend/src)

- `frontend/src/services/gameContext.tsx` — on `state_update`, read the envelope `openingRollIn`; store it as `openingRollCountdown` in context while phase is `opening_roll`; tick it down locally every second (display-only; the server owns the real timer). Clear it when the phase leaves `opening_roll`.
- `frontend/src/components/GameScreen/GameScreen.tsx` — the opening-roll overlays (your-turn RollPrompt and the "Waiting for opponent…" state) show a small line like "Auto-roll in {n}s" when the countdown is present.
- `frontend/src/types/context.ts` — add `openingRollCountdown: number | null` to `GameContextType`.

## Edge Cases

- Both dice equal → tie-reset: still `opening_roll`, turn resets to white; re-arm the timer.
- White already rolled, black hasn't → only black gets auto-rolled.
- Reconnect during `opening_roll` → server re-arms; client receives the current countdown via `openingRollIn` in the initial `state_update`.
- Dice service unavailable during an auto-roll → log the error and do not roll (retry is not needed; the timer is per-room and disconnects cleanly). Match the existing `_handle_roll_intent` error handling for `DiceServiceError`.

## Testing (TDD)

Backend (backend/game/tests.py):

1. With `patch(GameConsumer.OPENING_ROLL_DELAY, 0.2)`, both players connected, black never taps → after the delay the room broadcasts black's opening die; white's die is untouched.
2. A manual tap that hands the turn to the other player still re-arms the opening timer (broadcast countdown keeps counting).
3. Reconnect while in `opening_roll` re-arms the timer and the initial `state_update` includes `openingRollIn`.
4. Existing suite stays green (93 tests + new).

Frontend (frontend/src/services/gameContext.test.tsx):

5. Emit a `state_update` with envelope `openingRollIn: 12` while in `opening_roll` → context countdown is set and ticks down.
6. Leaving `opening_roll` clears the countdown.
