# Player Names in Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Show both players' usernames in the game side panel (online mode only), falling back to the current generic labels when a name is missing.

**Architecture:** The backend includes a `players: {white, black}` map of usernames in the initial `state_update` WebSocket message. The frontend `GameContext` stores `whiteName`/`blackName`, and `SidePanel` uses them to build self/opponent labels. `LocalGameProvider` provides `null` names so local/AI games keep the existing labels.

**Tech Stack:** Django Channels (backend WS consumer), React 18 + TypeScript (frontend), Playwright Component Tests (frontend tests), Django `TransactionTestCase` (backend tests).

---

### Task 1: Backend — send usernames in initial WS message

**Files:**
- Modify: `backend/game/consumers.py`
- Test: `backend/game/tests.py`

- [x] **Step 1: Write the failing test**

Add to `backend/game/tests.py`, inside `GameConsumerTests`:

```python
async def test_initial_state_update_includes_player_usernames(self):
    communicator = self._make_communicator(self.white_user)
    connected, _ = await communicator.connect()
    self.assertTrue(connected)

    response = await communicator.receive_json_from()
    self.assertEqual(response["type"], "state_update")
    self.assertEqual(response["players"], {"white": "white", "black": "black"})

    await communicator.disconnect()
```

- [x] **Step 2: Run the test to verify it fails**

Run: `python manage.py test game.tests.GameConsumerTests.test_initial_state_update_includes_player_usernames`
Expected: FAIL — `KeyError: 'players'` (message has no `players` field).

- [x] **Step 3: Add helper `get_room_player_usernames`**

In `backend/game/consumers.py`, after `get_room_player_color` (around line 36), add:

```python
@database_sync_to_async
def get_room_player_usernames(room_id):
    """Return usernames for the room's players keyed by color."""
    names = {"white": None, "black": None}
    rps = RoomPlayer.objects.filter(room_id=room_id).select_related('player__user')
    for rp in rps:
        names[rp.color] = rp.player.user.username if rp.player and rp.player.user else None
    return names
```

- [x] **Step 4: Include `players` in the initial state_update**

In `GameConsumer.connect()`, replace the initial send (lines 161-166):

```python
        players = await get_room_player_usernames(self.room_id)

        await self.send(json.dumps({
            'type': 'state_update',
            'payload': state_data,
            'playerColor': self.player_color,
            'initial': True,
            'players': players,
        }))
```

- [x] **Step 5: Run the test to verify it passes**

Run: `python manage.py test game.tests.GameConsumerTests.test_initial_state_update_includes_player_usernames`
Expected: PASS.

- [x] **Step 6: Run full backend test suite**

Run: `python manage.py test game`
Expected: all tests pass.

- [x] **Step 7: Commit**

```bash
git add backend/game/consumers.py backend/game/tests.py
git commit -m "feat(backend): include player usernames in initial ws message"
```

---

### Task 2: Frontend context — expose whiteName/blackName

**Files:**
- Modify: `frontend/src/types/context.ts`
- Modify: `frontend/src/services/gameContext.tsx`
- Modify: `frontend/src/services/localGameContext.tsx`
- Modify: `frontend/src/test-utils/wrappers.tsx`

- [x] **Step 1: Add fields to `GameContextType`**

In `frontend/src/types/context.ts`, inside `GameContextType`, after `playerColor: Color;` add:

```ts
  whiteName: string | null;
  blackName: string | null;
```

- [x] **Step 2: Store names in `GameProvider`**

In `frontend/src/services/gameContext.tsx`:

Add state (near line 40):

```tsx
  const [whiteName, setWhiteName] = useState<string | null>(null);
  const [blackName, setBlackName] = useState<string | null>(null);
```

In the `isInitial` branch of the `state_update` handler (after `setState(raw as unknown as GameState);`), add:

```tsx
            const players = (msg as Record<string, unknown>).players as { white?: string | null; black?: string | null } | undefined;
            if (players) {
              setWhiteName(players.white ?? null);
              setBlackName(players.black ?? null);
            }
```

Add `whiteName, blackName` to the provider value (near line 363):

```tsx
        whiteName,
        blackName,
```

- [x] **Step 3: Provide `null` names in `LocalGameProvider`**

In `frontend/src/services/localGameContext.tsx`, add `whiteName: null, blackName: null` to the provider value (near line 333).

- [x] **Step 4: Add names to the test mock context**

In `frontend/src/test-utils/wrappers.tsx`, in `makeMockContext`, add:

```ts
    whiteName: null,
    blackName: null,
```

- [x] **Step 5: Verify build + lint**

Run: `pnpm build && pnpm lint`
Expected: no TypeScript errors, no lint errors.

- [x] **Step 6: Commit**

```bash
git add frontend/src/types/context.ts frontend/src/services/gameContext.tsx frontend/src/services/localGameContext.tsx frontend/src/test-utils/wrappers.tsx
git commit -m "feat(frontend): expose player names in game context"
```

---

### Task 3: SidePanel — display usernames with fallback

**Files:**
- Modify: `frontend/src/components/SidePanel/SidePanel.tsx`
- Test: `frontend/src/components/SidePanel/SidePanel.test.tsx` (new)

- [x] **Step 1: Write the failing component tests**

Create `frontend/src/components/SidePanel/SidePanel.test.tsx`:

```tsx
import { test, expect } from "@playwright/experimental-ct-react";
import SidePanel from "./SidePanel";
import { MockGameWrapper, makeGameState } from "../../test-utils/wrappers";

test("shows usernames for both players when provided", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white" context={{ whiteName: "alice", blackName: "bob" }}>
      <SidePanel state={makeGameState({ turn: "white" })} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByText("alice")).toBeVisible();
  await expect(component.getByText("bob")).toBeVisible();
  await expect(component.getByText("alice", { exact: true })).toBeVisible();
});

test("falls back to generic labels when names are null", async ({ mount }) => {
  const component = await mount(
    <MockGameWrapper playerColor="white">
      <SidePanel state={makeGameState({ turn: "black" })} playerColor="white" onLeave={() => {}} />
    </MockGameWrapper>,
  );

  await expect(component.getByText("You (White)")).toBeVisible();
  await expect(component.getByText("Black Player")).toBeVisible();
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/SidePanel/SidePanel.test.tsx`
Expected: FAIL — "alice" / "bob" not found (labels still generic).

- [x] **Step 3: Update `SidePanel.tsx` to use names**

Replace the label computation in `frontend/src/components/SidePanel/SidePanel.tsx`:

```tsx
  const { giveUp, whiteName, blackName } = useGame();
```

Replace lines 20-22:

```tsx
  const opponentColor = playerColor === "white" ? "black" : "white";
  const opponentName = playerColor === "white" ? blackName : whiteName;
  const selfName = playerColor === "white" ? whiteName : blackName;
  const opponentLabel = opponentName || (playerColor === "white" ? "Black Player" : "White Player");
  const selfLabel = selfName ? `${selfName} (you)` : (playerColor === "white" ? "You (White)" : "You (Black)");
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm test src/components/SidePanel/SidePanel.test.tsx`
Expected: PASS.

- [x] **Step 5: Verify build + lint**

Run: `pnpm build && pnpm lint`
Expected: no TypeScript errors, no lint errors.

- [x] **Step 6: Commit**

```bash
git add frontend/src/components/SidePanel/SidePanel.tsx frontend/src/components/SidePanel/SidePanel.test.tsx
git commit -m "feat: show player usernames in side panel with fallback"
```

---

### Task 4: Visual verification

- [ ] **Step 1: Run dev server**

Run: `pnpm dev` in `frontend/`. Open `http://localhost:5173`, log in, create a room, open a second browser to join.

- [ ] **Step 2: Verify**

- Each player sees the other's username and their own username with `(you)`.
- After reconnect (refresh), names still show (from the initial message).
- In local/AI mode (`/local`), labels stay `"You (White)"` / `"Black Player"` / `"You (Black)"` / `"White Player"`.
