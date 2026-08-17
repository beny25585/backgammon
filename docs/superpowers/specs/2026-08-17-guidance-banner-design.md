# Unified Player Guidance Banner

Date: 2026-08-17

## Problem

Player guidance is fragmented across several disconnected UI elements. There is no single source of truth telling the player what to do right now:

- Roll prompt is a separate animated overlay (`RollPrompt`, "Tap to roll") rendered only during the rolling phase (`GameBoard.tsx:95`).
- The in-play dice display is a separate felt overlay (`GameBoard.tsx:90`).
- Opening-roll overlays and the "No moves available" card are separate full-screen dim overlays at the `GameScreen` level (`GameScreen.tsx:156-251`).
- Double Accept/Decline buttons live in the side panel `Controls` (`Controls.tsx:31`).
- The engine already generates `state.message` ("White — make a move", "confirm end of turn", "No legal moves") but it is **never displayed** in the UI.

The README references a `TurnIndicator` component that no longer exists in the code.

## Approach

Add a single always-visible **guidance banner** overlaid at the top-middle of the board felt. It consolidates every prompt into one place:

- Replaces the `RollPrompt` overlay and the felt dice overlay in `GameBoard`.
- Replaces the opening-roll overlay cards and the "No moves available" card in `GameScreen`.
- Absorbs the double Accept/Decline buttons from `Controls`.
- Manages its own tap→spin→land roll animation (taking over `GameScreen`'s `landing`/`rollResult`/`handleRollLand` bookkeeping).

The banner is driven by a pure function `getGuidance(state, playerColor)` so the exact same component works in multiplayer and local/AI mode (both routes share `GameScreen` → `GameBoard`).

## Components / Files

### 1. Pure logic — `src/components/GuidanceBanner/guidance.ts`

```ts
export type GuidanceVariant =
  | "roll"        // your turn — tap to roll (opening or normal)
  | "move"        // your turn — tap a checker to move
  | "opponent"    // opponent is thinking / waiting
  | "double"      // opponent offered a double — respond
  | "opening"     // opening-roll result (you/opponent go first)
  | "no-moves"    // no moves available — turn passes
  | "confirm";    // your turn — all dice used, confirm

export interface Guidance {
  variant: GuidanceVariant;
  text: string;
  dice: number[];      // dice to display (remaining during your move, [] otherwise)
  remaining: number[]; // which dice are still available (for used-dice greying)
  interactive: "roll" | "double" | null;
}

export function getGuidance(state: GameState, playerColor: Color): Guidance | null;
```

Mapping (`state`, `playerColor` → banner):

| State | Banner |
|---|---|
| `phase === "game_over"` | `null` (result overlay owns the screen) |
| `opening_roll`, `turn === playerColor` | "Roll to start" — tap-to-roll dice, `interactive: "roll"` |
| `opening_roll`, else | "Waiting for opponent's roll" |
| `opening_result`, winner is player | "You go first!" |
| `opening_result`, else | "Opponent goes first" |
| `doubling_offered`, responder is player | "Opponent offers a double!" — Accept/Decline, `interactive: "double"` |
| `doubling_offered`, offerer is player | "Waiting for their response" |
| `rolling`, `turn === playerColor` | "Your turn — tap to roll" — tap-to-roll dice, `interactive: "roll"` |
| `rolling`, else | "Opponent is thinking…" |
| `moving`, your turn, `remaining.length > 0`, has legal moves | "Your turn — tap a checker to move" + remaining dice |
| `moving`, your turn, `remaining.length > 0`, zero legal moves | "No moves available — turn passes" |
| `moving`, your turn, `remaining.length === 0` | "Confirm your turn" |
| `moving`, else | "Opponent is thinking…" |

Guidance variant colors the banner accent (gold for your turn, muted for opponent/waiting, red for double/no-moves).

### 2. Component — `src/components/GuidanceBanner/GuidanceBanner.tsx`

Props:

```ts
interface GuidanceBannerProps {
  state: GameState;
  playerColor: Color;
  onRoll: () => void;              // regular roll
  onOpeningRoll: () => void;       // opening-roll
  respondToDouble: (accept: boolean) => void;
}
```

Behavior:

- Calls `getGuidance(state, playerColor)`; renders `null` when guidance is `null`.
- `interactive: "roll"` → renders the tap-to-roll dice (reusing `RollingDie` + `Die` visuals from the existing animation components). Manages its own spin state: tap → spin → call `onRoll`/`onOpeningRoll` after the spin starts → land on `state.dice` when it arrives. The `landing`/`rollResult`/`handleRollLand` state moves here from `GameScreen`.
- `interactive: "double"` → renders Accept/Decline buttons that call `respondToDouble(true/false)`.
- Non-interactive variants render text (+ dice during your move).
- `variant: "opponent"` and `"opening"` render muted styling; your-turn variants render gold styling.
- Reuses the existing doubles-expansion logic (a pair like `[3,3]` renders 4 dice).

### 3. Styling — `src/components/GuidanceBanner/GuidanceBanner.module.css`

- Absolute-positioned pill/card, horizontally centered, near the top of the felt (below the center bar).
- Dark translucent background, gold accent for your-turn variants, muted gray for opponent/waiting, red for double/no-moves.
- Uses theme variables from `global.css` (`--gold`, `--checker-white`, `--checker-black`).
- Dice and text inline; entrance animation via motion, no constant blinking.
- Responsive: text shrinks and dice scale down on narrow screens (`clamp()`), stays readable over the top points.

### 4. Integration — `src/components/GameScreen/GameBoard.tsx`

- Mount `<GuidanceBanner>` inside `boardArea`.
- Remove the felt dice overlay (`GameBoard.tsx:90-94`) and the `RollPrompt` overlay (`GameBoard.tsx:95-104`).
- `needsToRoll`, `onRoll`, `rollResult`, `onRollLand`, `landing` props are replaced by a single `onRoll` passed through to the banner. The banner derives roll/land from `state`.

### 5. Integration — `src/components/GameScreen/GameScreen.tsx`

- Remove the `landing`, `rollResult`, `handleRollLand`, `handleRoll`, `handleOpeningRoll` local state/callbacks.
- Remove the opening-roll overlay cards (`GameScreen.tsx:156-236`) and the "No moves available" overlay (`GameScreen.tsx:238-251`).
- Pass `onRoll` / `onOpeningRoll` / `respondToDouble` into `GameBoard` (from `useGame()`), which passes them to the banner.

### 6. Integration — `src/components/Controls/Controls.tsx`

- Remove the Accept/Decline double-response block (`Controls.tsx:31-47`). `Controls` keeps the `DoublingCube` display and the "✕2 Double" offer button.

### 7. Index — `src/components/GuidanceBanner/index.ts`

Default-export `GuidanceBanner` (and `getGuidance` for tests), following the existing one-folder-per-component pattern.

## Data Flow

- `GameScreen` gets `rollDice`, `openingRollResult` flow, and `respondToDouble` from `useGame()` (both `gameContext` and `localGameContext` expose identical APIs — verified).
- Banner renders from `state` + `playerColor` only; no engine or backend changes.
- Roll result arrives via `state.dice`; the banner lands the animation on that value (same flow the old `RollPrompt`/`landing` used).

## Error Handling

- `getGuidance` is total: every `Phase` × (your turn / opponent) combination returns a `Guidance` or `null`; no thrown errors.
- `state.message` is intentionally **not** used as the banner source — it is color-based ("White — make a move"), not player-relative, and would show the wrong phrasing for the local player. It stays engine-internal.

## Testing

- New `src/components/GuidanceBanner/guidance.test.ts`: unit-test `getGuidance` across every phase × (your turn / opponent turn), including opening-roll tie reset, doubles, double-offer (offerer vs responder), and the no-moves case.
- New `src/components/GuidanceBanner/GuidanceBanner.test.tsx`: renders correct text per variant, fires `onRoll` on tap, Accept/Decline call `respondToDouble(true/false)`.
- Update existing tests that assert on removed overlays: `GameBoard.test.tsx` (roll prompt, dice overlay), `GameScreen.test.tsx` (opening overlays, no-moves card), `Controls.test.tsx` (remove double-response assertions).
- Run `pnpm build` (typecheck) and the Playwright component tests.
- Manual: `pnpm dev`, play a local match and an AI match; verify the banner guides roll → move → confirm and shows opponent/waiting states correctly.

## Out of Scope

- Situation-aware hints (bar re-entry, bear-off, "use highest die on farthest checker") — basic turn instructions only for now.
- Move-suggestion highlighting (legal-move recommendations) — requires bot evaluation integration.
- Changes to the "✕2 Double" offer button placement in `Controls`.
- Engine, backend, or protocol changes.