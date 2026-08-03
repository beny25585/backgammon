# Player Names in Side Panel — Design

Date: 2026-08-03
Status: Approved design

## Goal

Show each player's username in the game side panel (online multiplayer only). Replace the generic labels (`"You (White)"`, `"Black Player"`) with real usernames, falling back to the generic labels whenever a name is unavailable.

## Current State

- `SidePanel.tsx:21-22` hardcodes labels: opponent is `"Black Player"`/`"White Player"`, self is `"You (White)"`/`"You (Black)"`.
- The backend already has the data: `PlayerSerializer` exposes `username` (`serializers.py:37`), and the WebSocket consumer already fetches the connecting player's username and broadcasts it in `player_joined` events (`consumers.py:168-175`).
- The initial `state_update` WS message includes `payload`, `playerColor`, and `initial`, but no names (`consumers.py:161-166`).
- `gameContext` stores no names; `LocalGameProvider` (local/AI mode) provides the same context shape.

## Approach

Send both players' usernames in the initial `state_update` WebSocket message. The frontend context reads them once and exposes them to the side panel.

### Backend (`backend/game/consumers.py`)

- Add async helper `get_room_player_usernames(room_id)` returning `{"white": str|None, "black": str|None}` by mapping `RoomPlayer` → `Player` → `user.username`.
- In `connect()`, fetch the usernames and include a `players` field in the initial `state_update` message.

### Frontend

- `types/context.ts`: add `whiteName: string | null` and `blackName: string | null` to `GameContextType`.
- `gameContext.tsx`: add `whiteName`/`blackName` state, populate from `msg.players` on the initial message, expose in the provider value.
- `localGameContext.tsx`: provide both names as `null` (local/AI mode keeps current labels).
- `SidePanel.tsx`: compute labels from names with fallback:
  - self: `"alice (you)"` or `"You (White)"` when no name
  - opponent: `"bob"` or `"Black Player"` when no name

## UI

```
┌─────────────────────────────┐
│  ◯ B                        │  ← opponent: "bob"
│  bob                        │
│  Off 8  Bar 1         3     │
│                             │
│  ● A    alice  (you)        │  ← you: "alice (you)"
│        Off 5          2     │
│              YOUR TURN      │
│                             │
│  [ Give Up ]  [ Leave ]     │
└─────────────────────────────┘
```

## Tests

- Backend: new `GameConsumerTests` case asserting the initial `state_update` includes `players` with both usernames keyed by color.
- Frontend: new `SidePanel.test.tsx` (Playwright CT) asserting usernames render for self and opponent, and that generic labels are used as fallback when names are null.

## Files Touched

- Modify: `backend/game/consumers.py`
- Modify: `backend/game/tests.py`
- Modify: `frontend/src/types/context.ts`
- Modify: `frontend/src/services/gameContext.tsx`
- Modify: `frontend/src/services/localGameContext.tsx`
- Modify: `frontend/src/components/SidePanel/SidePanel.tsx`
- Create: `frontend/src/components/SidePanel/SidePanel.test.tsx`

## Non-Goals

- No nickname support (uses `user.username`).
- No names in local/AI mode.
- No name editing UI.
- No changes to `player_joined` events or the REST room APIs.
