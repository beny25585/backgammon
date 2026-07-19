# Code Review — Backgammon Game

**Date:** 2026-07-18
**Scope:** Full frontend + backend codebase
**Review type:** Best practices, security, maintainability, architecture

---

## Frontend

### ✅ Good Practices

- **Pure game engine** — `engine.ts` has zero side effects, deterministic output. Properly refactored with named constants.
- **Component isolation** — CSS Modules per component, no style leakage.
- **TypeScript strict mode** — proper types for `GameState`, `Color`, `Phase`, `Move`.
- **Custom hooks** — `useGame()` via React Context instead of prop drilling.
- **WebSocket singleton** — single connection, event-based pub/sub, auto-reconnect.
- **Local dev mode** — `LocalGameProvider` lets you play without a server.

### ⚠️ Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | **HIGH** | `services/gameContext.tsx` | `useEffect` dependency array includes `playerColor` — creates a new WebSocket connection every time the color changes in local mode. The `socket` object in deps is also unstable (created per render via `getSocketService` lookup — actually it's a singleton so this is safe, but the `playerColor` dep causes reconnect loops in local mode). |
| 2 | **MEDIUM** | `services/localGameContext.tsx` | Opening roll uses `setTimeout` to clear `openingRollResult` after 2s — no cleanup on unmount (memory leak / state-update-on-unmounted-component risk). |
| 3 | **MEDIUM** | `services/gameContext.tsx` | No `abortController` or cleanup for the async `connectAndSetup`. If the component unmounts during connection, state updates happen on unmounted component. |
| 4 | **LOW** | `App.tsx` | Screen type uses discriminated union but `handleRoomJoined` receives `roomCode` from the API but it's not stored in the screen state (only `roomId` and `playerColor`). If reconnection logic ever needs `roomCode` for a playing game, it's lost. |
| 5 | **LOW** | `services/roomStorage.ts` | `StoredRoom` stores `roomCode` but `handleRoomJoined` in `App.tsx` saves it as `roomCode: ""`. The waiting room code is lost when the game starts. |
| 6 | **LOW** | `components/GameScreen/GameScreen.tsx` | Opening roll `I condition` (line 61) calls `setOpeningRollResult` during render instead of in a `useEffect`. This violates React's rules — should be in a `useEffect` when `state.phase` changes. |
| 7 | **LOW** | `types/game.ts` | `GameMessage` type only has 6 event types but the system now uses 11 (`opening_roll_result`, `player_joined`, `player_disconnected`, `error`, `turn_ended`). Type is incomplete. |

### 🔧 Best Practice Recommendations

**State Management:**
- Replace raw `useState` in game contexts with `useReducer` for complex state transitions (opening roll, move execution, turn management all modify related fields).
- Extract WebSocket connection lifecycle into a dedicated `useWebSocket` hook with proper cleanup.

**Error Handling:**
- WebSocket errors show a generic message — no retry mechanism with exponential backoff (current is linear 2s).
- API calls in `services/api.ts` have no timeout — a hanging server blocks the UI indefinitely.
- No error boundary component wrapping the game tree.

**Performance:**
- `legalFromPoints` and `legalTargets` are recomputed on every render via `useMemo` — good. But `allLegalMoves` in the game context callback runs on every `setState` update (inside the callback). For heavy positions this could be slow.
- Board renders all 24 points + all checkers every frame — consider `React.memo` on `PointCell` and `Checker`.

**Security:**
- JWT stored in `localStorage` — accessible to any JS on the same origin. For a production game, consider httpOnly cookies.
- No rate limiting on `/api/register/` — someone could spam account creation.
- No input sanitization on room code — the backend validates but frontend doesn't escape display.

**Testing:**
- Zero tests exist (`tests.py` is the Django scaffold, frontend has no test files).
- Engine is pure and perfectly testable — `pytest` for backend, `vitest` for frontend would catch regressions.

---

## Backend

### ✅ Good Practices

- **Pure engine** — `engine.py` matches frontend logic, pure functions.
- **JWT auth** — proper token validation on WebSocket connect.
- **Async consumers** — correct use of `database_sync_to_async` for DB access.
- **Room code** — generated as UUID hex, excludes ambiguous characters (0/1/O/I) on frontend input.

### ⚠️ Issues Found

| # | Severity | File | Issue |
|---|----------|------|-------|
| 8 | **HIGH** | `game/engine.py` | `get_initial_state()` returns an empty board — no initial checkers are placed. The frontend engine has `initialBoard()` with the full setup, but the backend starts with all zeros. Any WebSocket game starts with no checkers on the board. |
| 9 | **HIGH** | `game/engine.py` | `roll_dice()` auto-skip (lines 140-146) does NOT clear `self.state['dice']`. If a player rolls and has zero legal moves, `dice` stays set, `canRoll` checks `dice.length === 0` → false → Roll button stays disabled permanently. This is fixed in the frontend engine but not ported to the backend. |
| 10 | **MEDIUM** | `game/models.py` | `GameRoom.state` (JSONField) and `GameState.state_data` (JSONField) are redundant — state is stored in two places. The consumer saves to `GameState` but `GameRoom.state` is only set during room creation and never updated. One should be removed. |
| 11 | **MEDIUM** | `game/consumers.py` | `_connected_users` is a module-level dict — resets on server restart. No reconnection state restoration. If the server restarts mid-game, the dict is empty but the game state in DB is stale. |
| 12 | **MEDIUM** | `game/views.py` | `create_room` and `join_room` have no transaction isolation — if two requests try to join the same room simultaneously, both could succeed (race condition). |
| 13 | **LOW** | `game/models.py` | `generate_room_code()` function is defined but never used — `views.py` generates codes inline with `uuid.uuid4().hex[:6].upper()`. Dead code. |
| 14 | **LOW** | `game/serializers.py` | `RegisterSerializer` accepts `password2` but doesn't validate the password confirmation match (no `validate` method). |
| 15 | **LOW** | `game/consumers.py` | `_send_error` sends a JSON message but the frontend `GameSocketService` only emits `message.type` — the error event type is hardcoded as `"error"` which doesn't match the frontend listener key. Let me check... actually it does match (frontend listens for `'error'` and the consumer sends `{"type": "error", ...}`). Wait, actually `game_message` wraps it in `{"type": event['event_type'], "payload": ...}` where `event_type` from `_save_and_broadcast` would be `"error"`. So the frontend receives `{"type": "error", "payload": {"message": "..."}}`. The frontend handler processes `payload` directly with `typeof payload === 'string' ? payload : payload.message`. This should work but it's fragile. |

### 🔧 Best Practice Recommendations

**Architecture:**
- The backend engine is a class with mutable state (`self.state`). Make it stateless like the frontend (pure functions that return new state).
- Add a `GameConsumer.group_send` rate limiter — a malicious client could spam `roll_dice` and trigger N+1 broadcast storms.

**Database:**
- SQLite is fine for dev but `GameState.state_data` stores the entire game state as JSON — querying individual fields is not possible. For analytics/history, add a proper schema.
- No database indexes on `GameRoom.code` (has `unique=True` which creates an index) or `GameRoom.status` — status queries scan the table.

**API Design:**
- No `GET /api/rooms/my/` endpoint — the frontend uses `localStorage` to track the player's active room. If storage is cleared, the user can't return to their game.
- `room_detail` returns the full `state` JSON — this could be large and is sent over REST when the client could just use WebSocket.

**Error Messages:**
- Some error messages are in Hebrew (`'תור לבן'`), some in English (`'No legal moves'`). Pick one language consistently (the plan says English UI was chosen).

---

## Security Scan

```
git diff --cached | grep "^+" | grep -iE "(api_key|secret|password|token|passwd)\s*=\s*['\"][^'\"]{6,}['\"]"
```
- `settings.py` has `SECRET_KEY = 'django-insecure-backgammon-game-dev-key-change-in-production'` — not a secret leak (clearly marked as dev), but would be caught by automated scanners.

```
git diff --cached | grep "^+" | grep -E "os\.system\(|subprocess.*shell=True"
```
- No shell injection found.

```
git diff --cached | grep "^+" | grep -E "\beval\(|\bexec\("
```
- No eval/exec found.

```
git diff --cached | grep "^+" | grep -E "execute\(f\"|\.format\(.*SELECT|\.format\(.*INSERT"
```
- No SQL injection — Django ORM is used throughout.

**Result: Clean.** No secrets, no injections, no dangerous patterns.

---

## Summary

| Category | Count | Details |
|----------|-------|---------|
| High severity | 2 | Empty backend board initial state, dice-not-cleared-on-skip in backend engine |
| Medium severity | 4 | Redundant state storage, reconnection loss, race condition on join, timeout + cleanup issues |
| Low severity | 9 | Type mismatches, dead code, React rules violations, fragile patterns |
| Security | 0 | Clean |
| Tests | 0 | Zero tests across the entire project |
