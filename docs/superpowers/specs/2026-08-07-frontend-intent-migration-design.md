# Frontend Intent Migration — Design

Date: 2026-08-07
Status: Approved design

## Goal

Convert the online frontend (`gameContext.tsx`) from the legacy full-state protocol to the
server's **intent-only** protocol, matching the backend change already made in
`backend/game/consumers.py`. The dice roll is the primary driver: the backend now rolls via
the Elixir `dice_service` and broadcasts the result, so the frontend must send a roll request
and render the dice the server sends back.

## Current State

- Backend `GameConsumer._handle_intent` (consumers.py:302) rejects any `state_update` that ships
  the full game state: `Full state updates are no longer accepted; send intents only`.
- It accepts intents: `roll`, `move`, `end_turn`, `undo`, `double`, `double_response`. The `roll`
  intent fetches dice from the Elixir service (`fetch_opening_dice`/`fetch_turn_dice`) and
  broadcasts the resulting authoritative state to both players. The opening roll is also resolved
  server-side once both sockets connect (`_resolve_opening_once`).
- The frontend `gameContext.tsx` still uses the old protocol:
  - `sendStateUpdate(newState, action)` sends `{ type: 'state_update', payload: { state: newState, action } }`.
  - `rollDice()` generates dice locally (`applyOpeningRoll`/`applyRoll` in `engine.ts`) and sends the whole state.
  - `makeMove`, `endTurn`, `undoMove`, `offerDouble`, `respondToDouble` all apply moves locally and ship full state.
- **Every online action is therefore currently rejected by the server** — the online game is broken.

## Approach

Make the online client **server-authoritative**: every action is sent as an intent over the
existing WebSocket; the server validates, applies, rolls, and broadcasts the authoritative state
back; the client renders the broadcast and never mutates game state locally.

Local-vs-bot mode (`localGameContext.tsx`) is out of scope — it keeps its local engine and local
dice.

## Changes

### `frontend/src/services/gameContext.tsx`

1. **Send helper.** Replace `sendStateUpdate(newState, action)` with `sendIntent(payload: Record<string, unknown>)`
   that sends `{ type: 'state_update', payload }` (payload contains `action` plus intent fields).
   Remove the client-side stale-version guard on send (intents carry no version/state).

2. **`state_update` handler.** Treat every broadcast as authoritative:
   - Apply `payload` as state when `version > lastVersionRef`; ignore stale versions (`version <= lastVersionRef`).
   - Delete the "own echo" branch (`msg.playerColor === playerColor` → only stamp version). Without
     this the mover would skip applying the roll broadcast and never see the dice. The mover now
     applies its own broadcasts like any other.
   - Build `openingRollResult` from the received state for **both** `opening_roll` and
     `opening_result` phases (currently only `opening_roll`). Set `winner` from `state.turn` when
     phase is `opening_result`.

3. **`rollDice`.** Send `{ action: 'roll' }` for both `opening_roll` and `rolling` phases. Remove
   `applyOpeningRoll`, `applyRoll`, `allLegalMoves`, and the local no-moves auto-pass logic — the
   server's `engine.roll_dice` handles the auto-pass and broadcasts the result. The client relies on
   the broadcast to update `state.dice` / `phase`.

4. **`makeMove`.** Send `{ action: 'move', from, to }`. Remove local `applyMove` and local game-over
   detection (`endGame` on bear-off) — the server finalizes and broadcasts `game_ended` itself.

5. **`endTurn`.** Send `{ action: 'end_turn' }`.

6. **`undoMove`.** Send `{ action: 'undo' }`. Remove the version-preserving stamp on the restored
   state (the client no longer ships state).

7. **`offerDouble`** → `{ action: 'double' }`. **`respondToDouble`** → `{ action: 'double_response', accept }`.
   Remove local game-over handling in the double path (server broadcasts `game_ended` on decline).

8. **`giveUp`** — unchanged (already sends `game_ended` directly; the server's `_handle_game_ended`
   finalizes the room).

### `frontend/src/components/GameScreen/GameScreen.tsx`

- The opening is now server-driven. Show:
  - **`opening_roll`**: the `RollPrompt` when it is the player's turn to roll (tap sends
    `{ action: 'roll' }`, which lets the opening resolve before the opponent's socket connects);
    otherwise "Waiting for opponent...". The server auto-resolves as fallback when both sockets
    connect.
  - **`opening_result`**: the result overlay (my die, opponent die, winner) for the ~3s the server
    keeps this phase, built from the broadcast's `openingRoll` field.
- Build `openingRollResult` from broadcasts for both opening phases; clear it once the phase leaves
  the opening (extend the existing clearing effect to cover `opening_result`).

### `gameContext.tsx` — no-moves overlay

- Keep the **no-moves overlay** ("No moves available"). Detect the server auto-pass inside the
  `state_update` handler: when a broadcast arrives and the previous state (`stateRef`) was
  `phase === 'rolling'` with `turn === playerColor` (the player just rolled) and the new broadcast
  is `phase === 'rolling'`, opponent's turn, `dice.length === 0` — it is a pass after our roll.
  Set `noMovesMessage` (already a context state) briefly, then clear after ~1.5s. Only the player
  who rolled sees the overlay (opponent's `stateRef.turn` differs).

### Error handling

- `socket.on('error')` currently drops a full-screen error banner. Benign race: a roll intent during
  `opening_roll` can hit the server after the opening already auto-resolved, returning
  `Cannot roll now`. Ignore that one error when the current state is already past `opening_roll`
  (opening already resolved). All other errors (illegal move, not your turn, etc.) keep the banner.

## Data flow

```
User taps roll ──▶ sendIntent({action:'roll'})
                        │ WS
                        ▼
Django consumer ──▶ fetch dice from Elixir service
                        │ engine.apply (roll/move/etc.)
                        ▼
broadcast state_update (authoritative, version N+1) ──▶ both clients render broadcast
```

- The client never sends a `version` or `state`; the server's `last_sequence`/`version` is the only
  version authority.
- Server broadcasts for `roll`/`move`/etc. carry `playerColor` = the actor. Both clients apply them;
  the stale-version guard (`version <= lastVersionRef`) prevents regressions.

## Error handling summary

| Case | Behavior |
|---|---|
| Illegal move / not your turn | Server `error` → full-screen banner (unchanged) |
| Roll during opening that already auto-resolved | Ignored when state is past `opening_roll` |
| Dice service down | Server returns `error` (`Dice service error: ...`) → banner |

## Testing

- Rewrite `frontend/src/services/gameContext.test.tsx` (currently asserts the legacy full-state
  protocol). Assert:
  1. `rollDice` sends `{ payload: { action: 'roll' } }` (no `state` key).
  2. `makeMove` sends `{ payload: { action: 'move', from, to } }`.
  3. A server broadcast `state_update` is applied to context state (e.g. version bump + dice).
  4. `undoMove` sends `{ payload: { action: 'undo' } }`.
- `GameBoard.test.tsx` is pure presentational (mocked callbacks) — unaffected.
- Backend intent tests already pass (`backend/game/tests.py`).

## Verification

1. `cd frontend && pnpm lint`
2. `cd frontend && pnpm build` (tsc + vite)
3. `cd frontend && pnpm test` (Playwright component tests, including the rewritten `gameContext.test.tsx`)
4. Backend: `cd backend && .venv/bin/python manage.py test game` (intent tests already green)
5. Manual smoke: two browsers vs `dice_service` + Django — opening resolves, winner rolls, dice
   appear, moves/undo/double flow, no-moves overlay on a dead roll, game ends via server broadcast.

## Out of scope

- Backend changes (consumers/views/dice client already done and tested).
- `localGameContext.tsx` (local vs-bot mode keeps local engine + local dice).
- UI restyling of the dice / board (only behavior changes).
