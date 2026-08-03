# Centralized Game-End / Room-Close — Design

Date: 2026-08-03
Status: Approved design

## Goal

Make "the game ends" a single, centralized flow that both the frontend and backend funnel every ending possibility through, so future endings (forfeit, timeout, etc.) work without duplicating logic. When a game ends, the room must be closed so players are never stuck in a dead room and unable to open a new one.

## Current State

Game-end / room-close logic is scattered and inconsistent today:

| Ending | Backend behavior | Room closed? |
|---|---|---|
| Bear-off win | `consumers._handle_state_update` saves a `Match` only if a score reaches `target_points` | never |
| Double-decline | same as above | never |
| Give-up | `consumers._handle_give_up` saves a `Match` unconditionally and sets `room.status = 'completed'` | yes |

Consequences:

- After a normal win, `room.status` stays `'playing'` forever. `views.create_room` rejects the player ("Already in a room") and localStorage `activeRoom` never clears — the player is stuck.
- The frontend detects game-over in three separate spots (`makeMove`, `respondToDouble`, `giveUp`) with duplicated `setGameResult` blocks, plus a separate `give_up` WebSocket message and a `game_forfeited` listener.
- The backend only saves a `Match` when `target_points` is reached, but `_handle_give_up` saves one unconditionally — two different rules for the same concept.
- Online multiplayer has no game-result display at all; `gameResult` is set but never rendered.

## Approach

Frontend signals game-over through a single helper and a single WebSocket message; backend funnels every ending into one idempotent `finalize_room()` function. The room closes on **every** game end (not just when `target_points` is reached) — online has no next-game flow today, and always closing is what prevents stuck players.

### Backend — `game_service.py` (new)

New module `backend/game/game_service.py` with a pure-ORM function callable from both sync views and async consumers:

```
finalize_room(room, state, winner, win_type, reason) -> Match | None
  points = multiplier(win_type) × state.cube   # single=1, gammon=2, backgammon=3
  Guard: if room.status in ('completed', 'cancelled') → return None (idempotent)
  room.white_score  += points if winner == 'white' else 0
  room.black_score  += points if winner == 'black' else 0
  room.status = 'completed'; room.save()
  Create Match(room=room, match_type='online', target_points=room.target_points,
               white_score=room.white_score, black_score=room.black_score,
               winner=winner,
               games=[{game_number: 1, winner, win_type, points_awarded: points,
                       transcript: extract_transcript(state)}])
  Return the Match
```

Points are computed in exactly one place — inside `finalize_room` — as `multiplier(win_type) × state.cube`. `reason` is a free-form string (`"bear_off"`, `"double_decline"`, `"give_up"`, ...) recorded so future endings are distinguishable.

### Wire protocol — one `game_ended` message

- Client → Server: `{ "type": "game_ended", "payload": { "winner", "winType", "reason", "cube" } }`
- Server → Room (broadcast): `{ "type": "game_ended", "payload": { "winner", "loser", "winType", "reason", "points", "cube", "whiteScore", "blackScore", "targetPoints" } }`

The old `game_forfeited` message type is removed on both sides.

### Frontend — `endGame()` helper

In `frontend/src/services/gameContext.tsx` add a single helper `endGame(winner, winType, reason, cube)` that sets the local `gameResult` and sends the `game_ended` message. All three endings call it:

- `makeMove` → `endGame(next.winner, next.winType || "single", "bear_off", next.cube || 1)` (replaces the inline block)
- `respondToDouble` decline → `endGame(next.winner, next.winType || "single", "double_decline", next.cube || 1)` (replaces the inline block)
- `giveUp` → `endGame(opponentColor, "single", "give_up", state.cube || 1)` (replaces the `give_up` message)

A new `game_ended` listener (replaces `game_forfeited`) sets `gameResult` from the authoritative server payload and calls `clearRoom()` so localStorage doesn't point at a closed room.

### Online result overlay

`GameScreen` renders the existing `GameResultOverlay` when `gameResult` is set (online currently shows nothing). Because the room closes on every game end, the overlay shows match-over + "Back to Home".

`GameResultOverlay` gets a `playerColor` prop so "you won/lost" is computed against the actual player color instead of assuming white; local mode passes `"white"` to keep current behavior.

## Backend guards

1. `finalize_room` is idempotent — a second `game_ended` (both clients, or a race) is a no-op.
2. `_handle_state_update`: if it sees `phase === "game_over"` with a winner, route to `finalize_room` as a fallback (covers a lost `game_ended` message).
3. On WebSocket connect: if the saved state is `game_over` and the room is still `playing`, auto-finalize and broadcast — a returning player never lands in a dead room.
4. `views.create_room`: if the player's active room is `playing` but its state is `game_over`, auto-finalize it instead of rejecting with "Already in a room" — the direct fix for "stuck and can't open a new one".
5. `_handle_give_up` becomes a thin wrapper that calls `finalize_room` with `reason="give_up"` and broadcasts `game_ended`.

## Tests

- Backend (`game/tests.py`):
  - `finalize_room` computes points, updates scores, closes the room, saves a `Match`, and is idempotent on repeat calls.
  - Receiving `game_ended` finalizes the game, broadcasts `game_ended` to the room, and closes it.
  - `give_up` routes through `finalize_room` and broadcasts `game_ended`.
  - Connecting to a room whose saved state is `game_over` auto-finalizes it.
  - `create_room` auto-finalizes a stale `playing` room with `game_over` state instead of returning "Already in a room".
- Frontend (`gameContext` tests via existing component test setup):
  - Each ending (`makeMove` win, double-decline, `giveUp`) sends `game_ended` with the correct reason.
  - The `game_ended` listener sets `gameResult` from the payload and clears the stored room.

## Files Touched

- Create: `backend/game/game_service.py`
- Modify: `backend/game/consumers.py`
- Modify: `backend/game/views.py`
- Modify: `backend/game/tests.py`
- Modify: `frontend/src/services/gameContext.tsx`
- Modify: `frontend/src/components/GameScreen/GameScreen.tsx`
- Modify: `frontend/src/components/GameResultOverlay/GameResultOverlay.tsx`
- Modify: `frontend/src/services/localGameContext.tsx` (pass `playerColor="white"` to overlay)
- Modify: `frontend/src/types/context.ts` (no changes expected; verified during implementation)

## Non-Goals

- No multi-game match flow (rooms close after every game; a future "keep room open, reset board" branch slots into `finalize_room`).
- No periodic/background cleanup of stale waiting rooms.
- No change to the local/AI match scoring behavior.
- No rating or player-stat updates.
