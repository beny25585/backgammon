# Chess-Clock Per-Move Timer — Design

Date: 2026-08-03
Status: Approved design

## Goal

Add a per-move chess clock to both online multiplayer and local/AI play. Each player has a time budget (`base`) that only counts down while it is their turn to act, plus a `bonus` added after each completed turn. If a player's clock hits zero on their turn, they forfeit and the opponent wins.

The clock is **server-authoritative in online mode**: the backend owns the time, ignores any client-provided clock values, enforces timeouts, and the client only displays. Local/AI mode (no server) runs the same clock logic client-side.

## Terminology

- **Base**: each player's starting time, in ms (e.g. `180_000` = 3:00).
- **Bonus**: ms added to a player's clock after they complete a turn (user's preferred name for "increment").
- **Time control**: a preset pairing of base + bonus, e.g. `"3+10"` = 3:00 base + 10s bonus.

## Current State

- The game state JSON already carries turn/phase everywhere. Both players receive every `state_update` broadcast (`consumers.py:304-312`), and the initial WS message already includes `players` (`consumers.py:173-179`).
- The server currently **relays** whatever state a client sends; it does not validate moves. Our timer follows the same "server owns the clock, relays the board" pattern — a step toward authority without requiring move validation.
- `MatchSettings` already collects target + color for both modes (`MatchSettings.tsx`); rooms store config on `GameRoom` (`models.py:23-36`); local mode passes config through URL params (`router.tsx:50-64`).
- `give_up` already exists end-to-end: `gameContext.giveUp()` → WS `give_up` → server declares opponent winner and broadcasts `game_forfeited` (`consumers.py:314-355`).

## Approach

### Time control presets

| id | label | base | bonus |
|----|-------|------|-------|
| `none` | No limit | — | — |
| `1+5` | 1:00 + 5s | 60s | 5s |
| `2+10` | 2:00 + 10s | 120s | 10s |
| `3+10` | 3:00 + 10s (default) | 180s | 10s |
| `5+30` | 5:00 + 30s | 300s | 30s |

`time_control` is stored as the preset id string (`"3+10"`). Both sides parse it with a tiny `parseTimeControl` helper (frontend TS + backend Python mirror each other, consistent with the project's dual-engine philosophy).

### Who is "the active player" (the one whose clock runs)

Pure helper `activePlayer(state)`:

- `waiting` / `game_over` → `null` (clock stopped)
- `doubling_offered` → the **responder** (opponent of `doubleOfferedBy`)
- everything else → `state.turn`

### Clock transition

When the active player changes from `X` to `Y`:

```
elapsed = now - turnStartedAt
clock[X] = max(0, clock[X] - elapsed) + bonus
clock[Y] = clock[Y]           // unchanged; it was frozen while X acted
turnStartedAt = now
```

The bonus applies on every active-player change, including opening-roll handoffs (keeps the rule uniform and predictable). On the very first action of a game, `clock = { white: base, black: base }`.

### Server-authoritative clock (online)

New backend module `backend/game/clock.py` with pure helpers (`active_player`, `apply_transition`, `parse_time_control`) so the consumer stays thin and the logic is unit-testable.

**Stored state.** `GameState.state_data` gains two server-owned keys:

- `clock: { "white": ms, "black": ms }`
- `turnStartedAt`: epoch ms (server wall clock)

**Initialization (lazy).** The room's initial phase is `opening_roll` from the moment it is created (`engine.py:34`), even while waiting for a second player — so the clock must NOT start at room creation. The clock is initialized on the **first `state_update`** the server receives (i.e. the game's first roll). Until then no clock exists and no timeout task runs, so nobody can time out while waiting.

**On every `state_update`** (`consumers.py` `_handle_state_update`):

1. Load stored `clock`, `turnStartedAt`, and active player from the saved state.
2. If no `clock` yet → initialize to `{white: base, black: base}`, `turnStartedAt = now`.
3. Compute `newActive = activePlayer(incoming)`.
4. If `newActive != storedActive` → apply transition (elapsed + bonus), `turnStartedAt = now`.
5. **Overwrite the client-sent `clock` and `turnStartedAt` with the server-computed values** before storing and broadcasting. This is the anti-tamper guarantee: the client's numbers are always discarded.
6. If `clock[newActive] <= 0` → forfeit immediately (winner = opponent, reason `time`).
7. Otherwise schedule the deadline task for `newActive`.

**Deadline task.** A per-connection `asyncio.create_task` that sleeps until the active player's deadline, then re-reads the room state and only fires if the active player is unchanged, the phase is not `game_over`, and the deadline has passed — making it idempotent even though both players' connections schedule one. The task is:
- scheduled on `connect()` (for mid-game reconnect) and whenever the active player changes in a `state_update`,
- cancelled on `disconnect()`,
- re-scheduled from stored state when the other player disconnects/joins (`player_disconnected` / `player_joined`), so enforcement survives the active player leaving.

On fire: mark the game over, set `winner = opponent`, persist, and broadcast `game_forfeited` with `reason: "time"`. The existing `gameContext` `game_forfeited` handler shows the result overlay.

**No pause on disconnect.** The clock keeps running for whoever's turn it is regardless of connection status (consistent with the existing "opponent disconnected — you can keep playing" behavior, TODO 17). If the active player leaves and never returns, their clock runs out and they lose on time — self-resolving.

**Initial WS message.** Include `timeControl: room.time_control` and the current `clock` (if any) so both players and reconnecting players start from the same values.

### Local/AI & pass&play clock (client-side)

No server exists, so the same logic runs in the browser via a shared pure module `frontend/src/lib/clock.ts` (`activePlayerOf`, `applyClockTransition`, `parseTimeControl`, `TimeControl`). A `useLocalClock(state, timeControl, onTimeout)` hook:

- applies the transition when the active player changes (tracked in a ref),
- ticks a display timer for the active player,
- calls `onTimeout(color)` at zero,
- resets both clocks to base on a new game (`game_over → opening_roll`).

`onTimeout` marks the local state `game_over` with the opponent as winner; the existing `localGameContext` game-over effect scores it and shows `GameResultOverlay`.

### Frontend display

- `GameContextType` gains `timeControl: TimeControl | null` and `clock: Record<Color, number> | null`.
  - `gameContext` (online): `timeControl` parsed from the initial message; `clock = state?.clock`.
  - `localGameContext`: `timeControl` from URL param; `clock` from `useLocalClock`.
- `SidePanel` passes `clock` to `PlayerRow`.
- `PlayerRow` renders a `m:ss` chip (formatted ms) next to the existing chips. The active player's clock is highlighted; ≤10s turns it red. `timeControl === null` (No limit) renders `--:--`.
- Between server updates the number keeps moving via a small **display-only** countdown that extrapolates from the last received value + timestamp. Purely cosmetic; the server remains authoritative and tampering only affects one's own screen.

## UI

```
┌─────────────────────────────┐
│  ◯ bob                      │
│  Off 8  Bar 1         3:12  │  ← opponent clock (red if ≤10s)
│                             │
│  ● alice (you)              │
│  Off 5               2:47   │  ← your clock (highlighted on your turn)
│         YOUR TURN           │
│                             │
│  [ Give Up ]  [ Leave ]     │
└─────────────────────────────┘
```

`MatchSettings` gains a "Time control" section (tab rows like the existing color/target sections) with the five presets, default `3:00 + 10s`.

## Data Flow (online)

```
MatchSettings ── time:"3+10" ──► createRoom ──► GameRoom.time_control="3+10"
                                                    │
                    initial WS message ◄────────────┘  timeControl + clock
                                                    │
   client A ──state_update──► consumer: compute clock (ignore client clock),
                                  apply transition/bonus, save, broadcast
                                              │
                            clock/state broadcast to both clients (display only)
                                              │
                            deadline task fires → forfeit → game_forfeited("time")
```

## Tests

**Backend**
- `game/clock.py` unit tests: transition adds bonus on active-player change, floors at 0, no change while active is unchanged, timeout detection.
- Consumer tests (`GameConsumerTests`):
  - initial `state_update` includes `timeControl`.
  - first `state_update` initializes `clock` to base.
  - client-sent `clock`/`turnStartedAt` values are overwritten by server-computed ones (anti-tamper).
  - active-player change applies bonus and resets `turnStartedAt`.
  - elapsed ≥ remaining → forfeit broadcast with `reason: "time"` and winner = opponent.
  - deadline task fires a forfeit after a tiny deadline.

**Frontend**
- `lib/clock.ts` unit tests (transition, parse, active-player rule incl. doubling responder).
- `MatchSettings` renders the time control selector with the correct default.
- `PlayerRow` renders `m:ss`, `--:--` when No limit, and the low-time class at ≤10s.
- `localGameContext` timeout ends the game with opponent as winner.

## Files Touched

**Backend**
- Modify: `backend/game/models.py` — `GameRoom.time_control` (`CharField(max_length=20, default='3+10')`)
- Create: `backend/game/migrations/0004_gameroom_time_control.py`
- Create: `backend/game/clock.py` — pure helpers
- Modify: `backend/game/views.py` — `create_room` reads/stores `time`; `room_detail` returns it
- Modify: `backend/game/consumers.py` — clock init/transition, deadline task, `timeControl`+`clock` in initial message, forfeit-on-time
- Modify: `backend/game/tests.py`

**Frontend**
- Create: `frontend/src/lib/clock.ts` — pure helpers + `TimeControl`
- Modify: `frontend/src/types/context.ts` — `timeControl`, `clock` on `GameContextType`
- Modify: `frontend/src/types/game.ts` / `lib/backgammon/engine.ts` — optional `clock` on `GameState`
- Modify: `frontend/src/services/gameContext.tsx` — parse `timeControl`, expose `clock`
- Modify: `frontend/src/services/localGameContext.tsx` — `timeControl` prop, local clock + timeout
- Create: `frontend/src/hooks/useLocalClock.ts`
- Modify: `frontend/src/components/GameScreen/GameScreen.tsx` — pass `clock` to `SidePanel`
- Modify: `frontend/src/components/SidePanel/SidePanel.tsx` — forward `clock`
- Modify: `frontend/src/components/PlayerRow/PlayerRow.tsx` + `.module.css` — clock chip, low-time style
- Modify: `frontend/src/components/MatchSettings/MatchSettings.tsx` (+ css) — time control selector
- Modify: `frontend/src/components/HomeScreen/HomeScreen.tsx` — forward `time`
- Modify: `frontend/src/services/api.ts` — `createRoom({ time })`
- Modify: `frontend/src/router.tsx` — parse `time` for `/local`

## Non-Goals

- No server-side move validation (separate, larger project). A cheater could still fabricate a move; the clock itself is authoritative.
- No pause on disconnect.
- No per-player/editable time controls mid-match.
- No sounds or animations for low time.
- No changes to `Match`, `GameEvent`, or match-scoring logic beyond the forfeit-on-time broadcast.

## Decisions & Trade-offs

- **Server-authoritative clock, relayed board.** Consistent with the current architecture and directly closes the "extend my clock / never time out" cheat. Full anti-cheat additionally requires move validation, explicitly out of scope.
- **Bonus on every active-player change** (incl. opening-roll handoffs) keeps the rule uniform.
- **Lazy clock init on first `state_update`** avoids timing anyone out while the room is still waiting for a second player, despite the state's phase already being `opening_roll`.
- **Clock keeps running on disconnect** — self-resolving if the active player abandons, and consistent with the existing "keep playing" behavior.
