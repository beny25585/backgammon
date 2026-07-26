# Fix 2-Player Multiplayer — Implementation Steps

> **Best practices loaded:** `django-channels-best-practices` (backend), `typescript-react-best-practices` (frontend)
>
> **For Hermes:** Use subagent-driven-development — one subagent per task, with spec compliance + code quality review.

**Goal:** Fix 2-player (white vs black via WebSocket) so two humans can actually play a full game.

**Root cause:** Each `GameConsumer` has a stale in-memory `BackgammonEngine` — never reloaded from DB after opponent acts. Combined with empty initial board (zero checkers), the game is unplayable.

**Approach:** `_reload_engine()` before every action. DB is the source of truth.

**Tech Stack:** Django 5 + Channels 4 + Daphne + SQLite | React 19 + TypeScript + Vite

---

## Task 1: Fix empty backend board — add checker positions

**Objective:** Backend `get_initial_state()` must return the standard starting position with 15 checkers per side.

**Files:**
- Modify: `backend/game/engine.py:14-16`

**Step 1 — Write failing test**

In `backend/game/tests.py`:

```python
from django.test import TestCase
from .engine import BackgammonEngine

class EngineInitialStateTest(TestCase):
    def test_initial_board_has_30_checkers(self):
        state = BackgammonEngine.get_initial_state()
        total = sum(abs(v) for v in state['points'])
        self.assertEqual(total, 30)

    def test_initial_board_standard_position(self):
        state = BackgammonEngine.get_initial_state()
        self.assertEqual(state['points'][23], 2)   # 2 white on 23
        self.assertEqual(state['points'][12], 5)   # 5 white on 12
        self.assertEqual(state['points'][7], 3)    # 3 white on 7
        self.assertEqual(state['points'][5], 5)    # 5 white on 5
        self.assertEqual(state['points'][0], -2)   # 2 black on 0
        self.assertEqual(state['points'][11], -5)  # 5 black on 11
        self.assertEqual(state['points'][16], -3)  # 3 black on 16
        self.assertEqual(state['points'][18], -5)  # 5 black on 18
```

**Step 2 — Verify failure**

Run: `python manage.py test game.tests`
Expected: FAIL — `total` is 0, not 30

**Step 3 — Fix `get_initial_state()`**

Replace `p = [0] * 24` with:

```python
p = [0] * 24
# White (positive): 2 on 23, 5 on 12, 3 on 7, 5 on 5
# Black (negative): 2 on 0, 5 on 11, 3 on 16, 5 on 18
p[23] = 2
p[12] = 5
p[7] = 3
p[5] = 5
p[0] = -2
p[11] = -5
p[16] = -3
p[18] = -5
```

**Step 4 — Verify pass**

Run: `python manage.py test game.tests`
Expected: PASS (2/2)

**Step 5 — Commit**

```bash
git add backend/game/engine.py backend/game/tests.py
git commit -m "fix: add initial checker positions to backend engine"
```

---

## Task 2: Add `_reload_engine()` and call before every consumer action

**Objective:** Every consumer handler must load fresh state from DB before acting, solving the stale-engine architecture bug.

**Files:**
- Modify: `backend/game/consumers.py`

**Step 1 — Add `_reload_engine()` method**

Insert after `_send_error` (~line 250):

```python
async def _reload_engine(self):
    """Reload engine state from DB so we see the other player's changes."""
    room = await get_room(self.room_id)
    if not room:
        return
    gs = await get_game_state(room)
    self.engine = BackgammonEngine(gs.state_data)
```

**Step 2 — Call at start of every handler**

Add `await self._reload_engine()` as the first line in:
- `handle_roll_dice` (before the opening_roll check)
- `handle_move` (before make_move)
- `handle_offer_double` (before offer_double)
- `handle_respond_double` (before respond_to_double)
- `handle_end_turn` (before end_turn)
- `handle_undo_move` (before undo_move)

Pattern:

```python
async def handle_move(self, payload):
    await self._reload_engine()
    result = self.engine.make_move(
        payload.get('from'), payload.get('to'), self.player_color
    )
    ...
```

**Step 3 — Verify**

Start backend, open two browser tabs with different users, join same room:
- Both see 15 checkers each
- Opening roll works for both players
- First player can make a move
- Second player sees the move update
- Turn alternates correctly

**Step 4 — Commit**

```bash
git add backend/game/consumers.py
git commit -m "fix: reload engine from DB before every consumer action"
```

---

## Task 3: Fix `roll_dice()` — clear `dice` on auto-skip

**Objective:** When a player rolls and has zero legal moves, clear `dice` so the next player's `canRoll` check passes.

**Files:**
- Modify: `backend/game/engine.py:163-170`

**Step 1 — Write failing test**

Add to `backend/game/tests.py`:

```python
class EngineMoveTest(TestCase):
    def test_roll_dice_clears_on_skip(self):
        engine = BackgammonEngine()
        # Position white on point 0, black blocks points 1-5
        p = [0] * 24
        p[0] = 1           # single white checker
        p[1] = -2          # blocked
        p[2] = -2
        p[3] = -2
        p[4] = -2
        p[5] = -2
        engine.state['points'] = p
        engine.state['home'] = {'white': 14, 'black': 0}
        engine.state['bar'] = {'white': 0, 'black': 0}
        engine.state['turn'] = 'white'
        engine.state['phase'] = 'rolling'
        engine.roll_dice()
        self.assertEqual(
            engine.state['dice'], [],
            "dice should be cleared on auto-skip"
        )
        self.assertEqual(engine.state['phase'], 'rolling')
        self.assertEqual(engine.state['turn'], 'black')
```

**Step 2 — Verify failure**

Run: `python manage.py test game.tests`
Expected: FAIL — dice is `[x, y]`, not `[]`

**Step 3 — Fix `roll_dice()`**

Add `self.state['dice'] = []` in the no-legal-moves branch:

```python
if len(self.all_legal_moves(self.state['turn'])) == 0:
    self.state['remaining'] = []
    self.state['dice'] = []       # ← THE FIX
    self.state['turn'] = 'black' if self.state['turn'] == 'white' else 'white'
    self.state['phase'] = 'rolling'
    self.state['message'] = 'No legal moves'
```

**Step 4 — Verify pass**

Run: `python manage.py test game.tests`
Expected: PASS

**Step 5 — Commit**

```bash
git add backend/game/engine.py backend/game/tests.py
git commit -m "fix: clear dice on auto-skip in roll_dice"
```

---

## Task 4: Add transaction isolation to `join_room`

**Objective:** Two simultaneous joins for the same room must not both succeed.

**Files:**
- Modify: `backend/game/views.py:70-92`

**Step 1 — Add import and wrap in `transaction.atomic()`**

```python
from django.db import transaction

@api_view(['POST'])
def join_room(request):
    code = request.data.get('code', '').upper().strip()
    user = request.user
    with transaction.atomic():
        rooms = list(GameRoom.objects.select_for_update().filter(
            code=code, status='waiting'
        )[:1])
        if not rooms:
            return Response({'error': 'Room not found or already full'}, status=404)
        room = rooms[0]
        if room.black_player is not None:
            return Response({'error': 'Room is full'}, status=400)
        if room.white_player == user:
            return Response({'error': 'You are already in this room'}, status=400)
        room.black_player = user
        room.status = 'playing'
        room.save()
    return Response({...})
```

**Why `list(...[:1])` instead of `.get()`:** Inside `transaction.atomic()`, a `get()` raising `DoesNotExist` would roll back the entire transaction. Using `filter` + `[:1]` + `list` avoids this.

**Step 2 — Verify**

Manual: two browser tabs, same room code, click Join simultaneously — only one should succeed.
Automated: no test framework for views yet (add in a later task).

**Step 3 — Commit**

```bash
git add backend/game/views.py
git commit -m "fix: add transaction isolation to join_room"
```

---

## Task 5: Wire `game_finished` event + match scoring on backend

**Objective:** When a game ends (by move or double-decline), update `GameRoom` scores and broadcast a `game_finished` event.

**Files:**
- Modify: `backend/game/consumers.py`

**Step 1 — Add `_handle_game_over()` method**

```python
async def _handle_game_over(self):
    winner = self.engine.state.get('winner')
    win_type = self.engine.state.get('winType', 'single')
    cube = self.engine.state.get('cube', 1)
    base = 1 if win_type == 'single' else 2 if win_type == 'gammon' else 3
    points = base * cube

    room = await get_room(self.room_id)
    if room:
        if winner == 'white':
            room.white_score += points
        else:
            room.black_score += points
        await database_sync_to_async(room.save)()

    await self.channel_layer.group_send(
        self.room_group_name,
        {
            'type': 'game_message',
            'event_type': 'game_finished',
            'payload': {
                'winner': winner,
                'winType': win_type,
                'points': points,
                'cube': cube,
                'whiteScore': room.white_score if room else 0,
                'blackScore': room.black_score if room else 0,
            },
            'playerColor': self.player_color,
        }
    )
```

**Step 2 — Wire into `handle_move`**

After `_save_and_broadcast('move_made', ...)`:

```python
if self.engine.state.get('phase') == 'game_over':
    await self._handle_game_over()
```

**Step 3 — Wire into `handle_respond_double`**

After `_save_and_broadcast('double_response', ...)`:

```python
if self.engine.state.get('phase') == 'game_over':
    await self._handle_game_over()
```

**Step 4 — Commit**

```bash
git add backend/game/consumers.py
git commit -m "feat: add game_finished event and match scoring to backend"
```

---

## Task 6: Wire `game_finished` on frontend → show result overlay

**Objective:** `GameProvider` listens for `game_finished` and renders `GameResultOverlay` with score.

**Files:**
- Modify: `frontend/src/types/context.ts`
- Modify: `frontend/src/services/gameContext.tsx`
- Modify: `frontend/src/components/GameScreen/GameScreen.tsx`

**Step 1 — Add `gameResult` to `GameContextType`**

In `types/context.ts`:

```typescript
export interface GameContextType {
  // ... existing fields ...
  gameResult: {
    winner: Color;
    winType: "single" | "gammon" | "backgammon";
    points: number;
    cube: number;
    matchScore: Record<Color, number>;
  } | null;
  handleNextGame: () => void;
  handleHome: () => void;
}
```

**Step 2 — Add state + listener in `GameProvider`**

In `gameContext.tsx`:

```typescript
const [gameResult, setGameResult] = useState<GameContextType['gameResult']>(null);

const handleNextGame = useCallback(() => {
  setGameResult(null);
}, []);

const handleHome = useCallback(() => {
  setGameResult(null);
}, []);

// Add inside connectAndSetup:
socket.on('game_finished', (payload) => {
  const data = payload as {
    winner: Color;
    winType: "single" | "gammon" | "backgammon";
    points: number;
    cube: number;
    whiteScore: number;
    blackScore: number;
  };
  setGameResult({
    winner: data.winner,
    winType: data.winType,
    points: data.points,
    cube: data.cube,
    matchScore: { white: data.whiteScore, black: data.blackScore },
  });
});
```

**Step 3 — Render `GameResultOverlay` in `GameScreen`**

Import `GameResultOverlay` and add below the Board section:

```tsx
import GameResultOverlay from "../components/GameResultOverlay/GameResultOverlay";

// In the return, before the closing container div:
{gameResult && (
  <GameResultOverlay
    winner={gameResult.winner}
    winType={gameResult.winType}
    points={gameResult.points}
    cube={gameResult.cube}
    matchScore={gameResult.matchScore}
    matchTarget={state?.matchTarget || 7}
    matchWinner={null}
    onNext={handleNextGame}
    onHome={handleLeave}
  />
)}
```

**Step 4 — Commit**

```bash
git add frontend/src/types/context.ts frontend/src/services/gameContext.tsx frontend/src/components/GameScreen/GameScreen.tsx
git commit -m "feat: wire game_finished event to result overlay in multiplayer"
```

---

## Task 7: Fix player color in join navigation

**Objective:** When joining as black, the URL must include `?color=black` so the game knows which side is which.

**Files:**
- Modify: `frontend/src/components/HomeScreen/HomeScreen.tsx:68`

**Step 1 — Add `?color=` to navigate call**

Change:

```typescript
navigate(`/game/${room.id}`, { state: { playerColor: "black" } });
```

To:

```typescript
navigate(`/game/${room.id}?color=black`, { state: { playerColor: "black" } });
```

**Step 2 — Verify router reads it**

`router.tsx:27` already reads `?color=` from query params. Confirm it's working.

**Step 3 — Commit**

```bash
git add frontend/src/components/HomeScreen/HomeScreen.tsx
git commit -m "fix: pass playerColor as query param in game URL"
```

---

## Task 8: Add frontend engine tests

**Objective:** Prevent regressions on the pure engine functions.

**Files:**
- Create: `frontend/src/lib/backgammon/engine.test.ts`
- Update: `frontend/package.json` (add vitest if missing)

**Step 1 — Install vitest**

```bash
cd frontend && pnpm add -D vitest
```

**Step 2 — Write tests**

```typescript
import { describe, it, expect } from 'vitest';
import { newGame, initialBoard, cloneState, applyRoll, applyOpeningRoll } from './engine';

describe('newGame', () => {
  it('creates a board with 30 checkers total', () => {
    const game = newGame();
    const total = game.points.reduce((sum, v) => sum + Math.abs(v), 0);
    expect(total).toBe(30);
  });

  it('starts in opening_roll phase', () => {
    expect(newGame().phase).toBe('opening_roll');
  });

  it('has standard starting position', () => {
    const board = initialBoard();
    expect(board[23]).toBe(2);
    expect(board[12]).toBe(5);
    expect(board[0]).toBe(-2);
    expect(board[18]).toBe(-5);
  });
});

describe('cloneState', () => {
  it('returns a deep copy', () => {
    const a = newGame();
    const b = cloneState(a);
    b.points[0] = 999;
    expect(a.points[0]).not.toBe(999);
  });
});

describe('applyRoll', () => {
  it('transitions to moving phase with custom dice', () => {
    const game = newGame();
    game.phase = 'rolling';
    const next = applyRoll(game, [3, 1]);
    expect(next.phase).toBe('moving');
    expect(next.dice).toEqual([3, 1]);
    expect(next.remaining).toEqual([3, 1]);
  });
});

describe('applyOpeningRoll', () => {
  it('stores a die value for the player', () => {
    const game = newGame();
    const next = applyOpeningRoll(game, 'white');
    expect(next.openingRoll.white).not.toBeNull();
    expect(typeof next.openingRoll.white).toBe('number');
  });
});
```

**Step 3 — Run and verify**

```bash
cd frontend && npx vitest run
```
Expected: All 7 tests pass.

**Step 4 — Add test script to package.json**

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**Step 5 — Commit**

```bash
git add frontend/src/lib/backgammon/engine.test.ts frontend/package.json
git commit -m "test: add frontend engine unit tests"
```

---

## Task 9: Normalize engine messages to English

**Objective:** All user-facing strings in both engines should be English.

**Files:**
- Modify: `backend/game/engine.py`
- Optional: `frontend/src/lib/backgammon/engine.ts`

**Step 1 — Replace Hebrew in backend engine**

| Line | Hebrew → English |
|------|-----------------|
| `roll_dice` line 170 | `'תור {לבן/שחור}'` → `"White's turn"` / `"Black's turn"` |
| `_apply_move` line 272 | `'אשר סיום תור'` → `'Confirm turn'` |
| `_apply_move` line 282 | `'תור {לבן/שחור}'` → `"White's turn"` / `"Black's turn"` |

**Step 2 — Replace Hebrew in frontend engine (optional)**

Same messages in `engine.ts` — `newGame()` message, `applyMove()`, `applyOpeningRoll()`, etc.

**Step 3 — Commit**

```bash
git add backend/game/engine.py frontend/src/lib/backgammon/engine.ts
git commit -m "refactor: normalize engine messages to English"
```

---

## End-to-End Verification

After all 9 tasks:

1. **Backend tests**: `python manage.py test game.tests` → PASS
2. **Frontend tests**: `cd frontend && npx vitest run` → PASS
3. **Manual 2-player test**:
   - Start backend: `python manage.py runserver 8000`
   - Start frontend: `pnpm dev`
   - Open browser A → register UserA → create room → note room code
   - Open browser B (incognito) → register UserB → join with room code
   - Both see 15 checkers on a full board
   - Opening roll overlay shows for both
   - Player who wins opening roll makes first move
   - Moves appear on both screens in real-time
   - Turn alternates correctly
   - Game ends → both see result overlay with score
   - No Hebrew messages in the UI
4. **Edge cases**:
   - Rapid-join two tabs with same code → only one succeeds
   - Roll with no legal moves → turn auto-passes, roll button works for opponent
   - Reconnect mid-game → state reloads correctly

## Files Changed (Final List)

| # | File | What |
|---|------|------|
| 1 | `backend/game/engine.py` | Checker positions + dice clear fix + English messages |
| 2 | `backend/game/consumers.py` | `_reload_engine()` + `_handle_game_over()` |
| 3 | `backend/game/views.py` | `transaction.atomic()` on `join_room` |
| 4 | `backend/game/tests.py` | Engine tests (initial board + dice skip) |
| 5 | `frontend/src/types/context.ts` | `gameResult` field |
| 6 | `frontend/src/services/gameContext.tsx` | `game_finished` listener + state |
| 7 | `frontend/src/components/GameScreen/GameScreen.tsx` | `GameResultOverlay` render |
| 8 | `frontend/src/components/HomeScreen/HomeScreen.tsx` | `?color=black` in URL |
| 9 | `frontend/src/lib/backgammon/engine.test.ts` | New: frontend engine tests |
| 10 | `frontend/package.json` | `vitest` dep + test script |
