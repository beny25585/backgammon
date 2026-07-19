# Backgammon — Frontend

React 19 + TypeScript + Vite 5 + Tailwind CSS 4 + Motion — the UI layer.

---

## Setup

```bash
cd frontend
pnpm install
pnpm dev            # → http://localhost:5173
```

`.env`:
```
VITE_SERVER_URL=ws://localhost:8000
```

---

## Architecture

### Routing

The app uses `react-router-dom` v6 with auth guards:

| Route | Component | Auth |
|-------|-----------|------|
| `/` | AuthScreen | Redirect to `/home` if logged in |
| `/home` | HomeScreen | Required |
| `/waiting/:roomId` | WaitingRoom | Required |
| `/game/:roomId?color=` | GameProvider + GameScreen | Required |
| `/local` | LocalGameProvider (human-vs-human) | None |
| `/local?bot=&target=` | LocalGameProvider (vs AI, match to N) | None |

Routing in `src/router.tsx`. Auth guards in `RequireAuth` / `RedirectIfAuthed`.

### State Management

Two providers share a common `GameContext`:

- **`GameProvider`** (`gameContext.tsx`) — WebSocket multiplayer, connects to Django backend
- **`LocalGameProvider`** (`localGameContext.tsx`) — local mode, optional AI bot, match scoring

Both expose the same `useGame()` hook.

### Game Engine (`lib/backgammon/engine.ts`)

Pure TypeScript functions — same rules as the Python backend:

```typescript
export const BAR = "bar";
export const OFF = "off";
export type Source = number | typeof BAR;
export type Target = number | typeof OFF;

newGame()              → GameState
applyMove(state, move, color)   → GameState
allLegalMoves(state, color)     → Move[]
applyRoll(state)       → GameState
applyOpeningRoll(state, color)  → GameState
offerDouble(state, color)       → GameState
respondDouble(state, accept)    → GameState
```

Used client-side for legal move highlighting, AI evaluation, and local mode.

### Bot AI (`lib/bot/`)

Adapted from [backgammon-baddie](https://github.com/devensimonson/backgammon-baddie) (MIT):

- **`evaluate.ts`** — scores a position using named weights: pip count, blot exposure, made points, home board strength, prime pairs
- **`chooseMove.ts`** — 1-ply search: tries every legal move, scores the result, picks the best

```typescript
import { chooseMove } from "@/lib/bot/chooseMove";
const best = chooseMove(state, "black");
```

### Match Scoring (LocalGameProvider)

Automatically scored after each game:
- `winType × cube` points to the winner
- Match continues until someone reaches `matchTarget` (configurable 1-21)
- Auto-advance after 30s, or click "Next Game"
- `GameResultOverlay` shows result, win type, match progress

---

## Components

### Board (`components/Board/`)
SVG-like CSS grid: `[6 points | bar | 6 points | bear-off]`, 2 rows.
- Point indices: 0–11 bottom, 12–23 top
- spring-animated checkers with `motion.div`
- Legal-target gold glow, double-click auto-move

### Dice (`components/Dice/`)
- **3D rolling cube**: 6-face CSS cube with `preserve-3d`, `rotateX/Y/Z`, `backfaceVisibility: hidden`
- **Die**: pip patterns (1-6) with spring enter animation
- **DiceRow**: normal play (dice + used dimming) and opening roll (You/Opponent labels)
- **RollPrompt**: full-screen overlay with "Tap to roll", auto-results 600ms after click

### GameResultOverlay (`components/GameResultOverlay/`)
Appears after each game: winner, win type, points, match score, Next Game / Quit buttons.

### MatchSettings (`components/MatchSettings/`)
Pre-game dialog: play as White/Black, first to N points (1, 3, 5, 7, 9, 11, 13, 15, 21).

### Controls (`components/Controls/`)
Double, End Turn buttons. Roll button removed — handled by RollPrompt overlay.

---

## Type System

### `types/game.ts`
Re-exports engine types. Defines `GameMessage`:
```typescript
type GameMessage = {
  type: "state_update" | "move_made" | "dice_rolled" | "double_offered"
      | "double_response" | "game_finished" | "opening_roll_result"
      | "player_joined" | "player_disconnected" | "error";
  payload: unknown;
};
```

### `types/context.ts`
```typescript
interface GameContextType {
  state: GameState | null;
  playerColor: Color;
  isLoading: boolean;
  error: string | null;
  openingRollResult: OpeningRollResult | null;
  setOpeningRollResult: (r: OpeningRollResult | null) => void;
  reconnected: boolean;
  opponentConnected: boolean;
  updateState: (s: GameState) => void;
  makeMove: (from: Source, to: Target) => void;
  rollDice: () => void;
  offerDouble: () => void;
  respondToDouble: (accept: boolean) => void;
  endTurn: () => void;
}
```

---

## Styling

- **Tailwind CSS 4** — layout, spacing, typography
- **CSS Modules** (`.module.css`) — component-scoped complex layouts
- **CSS Variables** in `styles/global.css`:
  - `--board-frame`: `#3d2817`, `--board-felt`: `#8b5a2b`
  - `--checker-white`: `#f4e4c1`, `--checker-black`: `#2a1810`
  - `--gold`: `#c9a961`
- Fonts: Playfair Display (titles), Assistant (body)
- Dark background: `#030711`

### Fluid Sizing
```typescript
const POINT_H = "clamp(140px, 28vw, 240px)";
const CHECKER = "clamp(22px, 4.2vw, 36px)";
const BAR_W = "clamp(28px, 4vw, 42px)";
```

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `react` / `react-dom` | UI framework |
| `motion` | Spring animations, drag, 3D transforms |
| `react-router-dom` | URL-based routing |
| `tailwindcss` / `@tailwindcss/vite` | Utility-first CSS |
| `tw-animate-css` | Animation utilities |
| `@fontsource/playfair-display` | Title font |
| `@fontsource/assistant` | Body font |
| `typescript` | Type checking |
| `vite` / `@vitejs/plugin-react` | Build + HMR |

---

## Key Patterns

- **One folder per component**: `ComponentName/ComponentName.tsx` + `.module.css` + `index.ts`
- **Pure engine**: no side effects, no mutations, new state returned each call
- **Named constants**: `BAR`/`OFF` instead of `"bar"`/`"off"` everywhere
- **CSS Modules for scoped styles**, Tailwind for layout/utilities
