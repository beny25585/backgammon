# Unified Player Guidance Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single always-visible guidance banner over the board felt that consolidates all player prompts (roll, move, respond-to-double, opening roll, no-moves) into one state-driven component.

**Architecture:** A pure function `getGuidance(state, playerColor)` derives the banner content from game state + the local player's color. A new `GuidanceBanner` component renders the derived text/dice/interaction. It replaces the `RollPrompt` overlay and felt dice overlay in `GameBoard`, the opening-roll and no-moves overlays in `GameScreen`, and the Accept/Decline double buttons in `Controls`. Since both multiplayer and local routes share `GameScreen` → `GameBoard`, the banner works in both modes with zero extra wiring.

**Tech Stack:** React 19 + TypeScript + Vite + CSS Modules + Motion + Playwright component tests (`@playwright/experimental-ct-react`).

**Spec:** `docs/superpowers/specs/2026-08-17-guidance-banner-design.md`

---

### Task 1: `guidance.ts` pure logic + unit tests

**Files:**
- Create: `frontend/src/components/GuidanceBanner/guidance.ts`
- Test: `frontend/src/components/GuidanceBanner/guidance.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/GuidanceBanner/guidance.test.tsx`:

```tsx
import { test, expect } from "@playwright/experimental-ct-react";
import { getGuidance } from "./guidance";
import { makeGameState } from "../../test-utils/gameState";

test("returns null during game_over", () => {
  const g = getGuidance(makeGameState({ phase: "game_over" }), "white");
  expect(g).toBeNull();
});

test("waiting phase shows waiting text", () => {
  const g = getGuidance(makeGameState({ phase: "waiting" }), "white");
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Waiting to start");
});

test("opening roll on my turn → 'Roll to start' with roll interaction", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_roll", turn: "white" }),
    "white",
  );
  expect(g).toEqual({
    variant: "roll",
    text: "Roll to start",
    dice: [],
    remaining: [],
    interactive: "roll",
  });
});

test("opening roll on opponent's turn → waiting text, no interaction", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_roll", turn: "white" }),
    "black",
  );
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Waiting for opponent's roll");
  expect(g?.interactive).toBeNull();
});

test("opening result won → 'You go first!'", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_result", turn: "white" }),
    "white",
  );
  expect(g?.variant).toBe("opening");
  expect(g?.text).toBe("You go first!");
});

test("opening result lost → 'Opponent goes first'", () => {
  const g = getGuidance(
    makeGameState({ phase: "opening_result", turn: "white" }),
    "black",
  );
  expect(g?.text).toBe("Opponent goes first");
});

test("doubling offered to me → double interaction", () => {
  const g = getGuidance(
    makeGameState({
      phase: "doubling_offered",
      turn: "white",
      doubleOfferedBy: "black",
    }),
    "white",
  );
  expect(g?.variant).toBe("double");
  expect(g?.text).toBe("Opponent offers a double!");
  expect(g?.interactive).toBe("double");
});

test("doubling offered by me → waiting text", () => {
  const g = getGuidance(
    makeGameState({
      phase: "doubling_offered",
      turn: "white",
      doubleOfferedBy: "white",
    }),
    "white",
  );
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Waiting for their response");
});

test("rolling on my turn → roll interaction", () => {
  const g = getGuidance(makeGameState({ phase: "rolling", turn: "white" }), "white");
  expect(g?.variant).toBe("roll");
  expect(g?.text).toBe("Your turn — tap to roll");
  expect(g?.interactive).toBe("roll");
});

test("rolling on opponent's turn → 'Opponent is thinking…'", () => {
  const g = getGuidance(makeGameState({ phase: "rolling", turn: "black" }), "white");
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Opponent is thinking…");
});

test("moving on my turn with dice → move variant with dice", () => {
  const state = makeGameState({
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  const g = getGuidance(state, "white");
  expect(g?.variant).toBe("move");
  expect(g?.text).toBe("Your turn — tap a checker to move");
  expect(g?.dice).toEqual([4, 3]);
  expect(g?.remaining).toEqual([4, 3]);
});

test("moving on my turn with all dice used → confirm", () => {
  const g = getGuidance(
    makeGameState({ phase: "moving", turn: "white", dice: [], remaining: [] }),
    "white",
  );
  expect(g?.variant).toBe("confirm");
  expect(g?.text).toBe("Confirm your turn");
});

test("moving on my turn with no legal moves → no-moves", () => {
  const points = new Array(24).fill(0);
  points[18] = -2; // black blockade on white's entry point for die 6
  const g = getGuidance(
    makeGameState({
      phase: "moving",
      turn: "white",
      dice: [6],
      remaining: [6],
      bar: { white: 1, black: 0 },
      points,
    }),
    "white",
  );
  expect(g?.variant).toBe("no-moves");
  expect(g?.text).toBe("No moves available — turn passes");
});

test("moving on opponent's turn → 'Opponent is thinking…'", () => {
  const g = getGuidance(
    makeGameState({ phase: "moving", turn: "black", dice: [4, 3], remaining: [4, 3] }),
    "white",
  );
  expect(g?.variant).toBe("opponent");
  expect(g?.text).toBe("Opponent is thinking…");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `pnpm test guidance`

Expected: FAIL — module `./guidance` not found / `getGuidance` is not defined.

- [ ] **Step 3: Write the minimal implementation**

Create `frontend/src/components/GuidanceBanner/guidance.ts`:

```ts
import { allLegalMoves } from "@/lib/backgammon/engine";
import type { Color, GameState } from "@/lib/backgammon/engine";

export type GuidanceVariant =
  | "roll" // your turn — tap to roll (opening or normal)
  | "move" // your turn — tap a checker to move
  | "opponent" // opponent is thinking / waiting
  | "double" // opponent offered a double — respond
  | "opening" // opening-roll result
  | "no-moves" // no moves available — turn passes
  | "confirm"; // your turn — all dice used

export interface Guidance {
  variant: GuidanceVariant;
  text: string;
  dice: number[];
  remaining: number[];
  interactive: "roll" | "double" | null;
}

const NO_DICE: number[] = [];

export function getGuidance(
  state: GameState,
  playerColor: Color,
): Guidance | null {
  const isMyTurn = state.turn === playerColor;

  if (state.phase === "game_over") return null;

  if (state.phase === "waiting") {
    return {
      variant: "opponent",
      text: "Waiting to start",
      dice: NO_DICE,
      remaining: NO_DICE,
      interactive: null,
    };
  }

  if (state.phase === "opening_roll") {
    return isMyTurn
      ? { variant: "roll", text: "Roll to start", dice: NO_DICE, remaining: NO_DICE, interactive: "roll" }
      : { variant: "opponent", text: "Waiting for opponent's roll", dice: NO_DICE, remaining: NO_DICE, interactive: null };
  }

  if (state.phase === "opening_result") {
    return isMyTurn
      ? { variant: "opening", text: "You go first!", dice: NO_DICE, remaining: NO_DICE, interactive: null }
      : { variant: "opening", text: "Opponent goes first", dice: NO_DICE, remaining: NO_DICE, interactive: null };
  }

  if (state.phase === "doubling_offered") {
    const offered = state.doubleOfferedBy;
    return offered !== null && offered !== playerColor
      ? { variant: "double", text: "Opponent offers a double!", dice: NO_DICE, remaining: NO_DICE, interactive: "double" }
      : { variant: "opponent", text: "Waiting for their response", dice: NO_DICE, remaining: NO_DICE, interactive: null };
  }

  if (state.phase === "rolling") {
    return isMyTurn
      ? { variant: "roll", text: "Your turn — tap to roll", dice: NO_DICE, remaining: NO_DICE, interactive: "roll" }
      : { variant: "opponent", text: "Opponent is thinking…", dice: NO_DICE, remaining: NO_DICE, interactive: null };
  }

  if (state.phase === "moving") {
    if (!isMyTurn) {
      return { variant: "opponent", text: "Opponent is thinking…", dice: NO_DICE, remaining: NO_DICE, interactive: null };
    }
    if (state.remaining.length === 0) {
      return { variant: "confirm", text: "Confirm your turn", dice: NO_DICE, remaining: NO_DICE, interactive: null };
    }
    if (allLegalMoves(state, playerColor).length === 0) {
      return { variant: "no-moves", text: "No moves available — turn passes", dice: NO_DICE, remaining: NO_DICE, interactive: null };
    }
    return {
      variant: "move",
      text: "Your turn — tap a checker to move",
      dice: state.dice,
      remaining: state.remaining,
      interactive: null,
    };
  }

  return {
    variant: "opponent",
    text: "Waiting…",
    dice: NO_DICE,
    remaining: NO_DICE,
    interactive: null,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `frontend/`): `pnpm test guidance`

Expected: PASS — all 16 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GuidanceBanner/guidance.ts frontend/src/components/GuidanceBanner/guidance.test.tsx
git commit -m "feat: guidance logic for unified player guidance banner"
```

---

### Task 2: `GuidanceBanner` component + `size` prop on `RollingDie` + tests

**Files:**
- Modify: `frontend/src/components/animations/RollingDie/RollingDie.tsx`
- Create: `frontend/src/components/GuidanceBanner/GuidanceBanner.tsx`
- Create: `frontend/src/components/GuidanceBanner/GuidanceBanner.module.css`
- Create: `frontend/src/components/GuidanceBanner/index.ts`
- Test: `frontend/src/components/GuidanceBanner/GuidanceBanner.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/components/GuidanceBanner/GuidanceBanner.test.tsx`:

```tsx
import { test, expect, type ComponentFixtures } from "@playwright/experimental-ct-react";
import GuidanceBanner from "./GuidanceBanner";
import { makeGameState } from "../../test-utils/gameState";
import type { GameState } from "@/lib/backgammon/engine";

interface MountProps {
  phase: GameState["phase"];
  turn?: "white" | "black";
  playerColor?: "white" | "black";
  dice?: number[];
  remaining?: number[];
  onRoll?: () => void;
  respondToDouble?: (accept: boolean) => void;
}

async function mountBanner(mount: ComponentFixtures["mount"], props: MountProps) {
  const { phase, turn, playerColor = "white", dice = [], remaining = [], onRoll, respondToDouble } = props;
  const state = makeGameState({ phase, turn, dice, remaining });
  return mount(
    <GuidanceBanner
      state={state}
      playerColor={playerColor}
      onRoll={onRoll ?? (() => {})}
      respondToDouble={respondToDouble ?? (() => {})}
    />,
  );
}

test("renders null during game_over", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "game_over" });
  await expect(c.getByTestId("guidance-banner")).toHaveCount(0);
});

test("shows roll interaction on my turn in rolling phase", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "rolling", turn: "white" });
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "roll");
  await expect(c.getByText("Tap to roll")).toBeVisible();
});

test("shows roll interaction during opening roll on my turn", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "opening_roll", turn: "white" });
  await expect(c.getByText("Roll to start")).toBeVisible();
  await expect(c.getByTestId("guidance-roll-btn")).toBeVisible();
});

test("shows move text with dice during my moving turn", async ({ mount }) => {
  const c = await mountBanner(mount, {
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "move");
  await expect(c.getByText("Your turn — tap a checker to move")).toBeVisible();
  await expect(c.getByTestId("die")).toHaveCount(2);
});

test("shows opponent thinking text on opponent's turn", async ({ mount }) => {
  const c = await mountBanner(mount, {
    phase: "moving",
    turn: "black",
    playerColor: "white",
    dice: [4, 3],
    remaining: [4, 3],
  });
  await expect(c.getByText("Opponent is thinking…")).toBeVisible();
  await expect(c.getByTestId("die")).toHaveCount(0);
});

test("shows confirm text when all dice used", async ({ mount }) => {
  const c = await mountBanner(mount, { phase: "moving", turn: "white", remaining: [] });
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "confirm");
  await expect(c.getByText("Confirm your turn")).toBeVisible();
});

test("shows no-moves text when nothing legal is available", async ({ mount }) => {
  const points = new Array(24).fill(0);
  points[18] = -2; // black blockade on white's entry point for die 6
  const state = makeGameState({
    phase: "moving",
    turn: "white",
    dice: [6],
    remaining: [6],
    bar: { white: 1, black: 0 },
    points,
  });
  const c = await mount(
    <GuidanceBanner state={state} playerColor="white" onRoll={() => {}} respondToDouble={() => {}} />,
  );
  await expect(c.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "no-moves");
  await expect(c.getByText("No moves available — turn passes")).toBeVisible();
});

test("double offer shows Accept/Decline that call respondToDouble", async ({ mount }) => {
  let accepted: boolean | null = null;
  const state = makeGameState({
    phase: "doubling_offered",
    turn: "white",
    doubleOfferedBy: "black",
  });
  const c = await mount(
    <GuidanceBanner
      state={state}
      playerColor="white"
      onRoll={() => {}}
      respondToDouble={(a) => (accepted = a)}
    />,
  );
  await expect(c.getByText("Opponent offers a double!")).toBeVisible();
  await c.getByTestId("double-accept").click();
  await expect.poll(() => accepted).toBe(true);
  await c.getByTestId("double-decline").click();
  await expect.poll(() => accepted).toBe(false);
});

test("tapping the roll button calls onRoll after the spin starts", async ({ mount }) => {
  let rolled = 0;
  const c = await mountBanner(mount, {
    phase: "rolling",
    turn: "white",
    onRoll: () => rolled++,
  });
  await c.getByTestId("guidance-roll-btn").click();
  await expect(c.getByTestId("rolling-die")).toHaveCount(2);
  await expect.poll(() => rolled).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `frontend/`): `pnpm test GuidanceBanner`

Expected: FAIL — module `./GuidanceBanner` not found.

- [ ] **Step 3: Add a `size` prop to `RollingDie`**

Edit `frontend/src/components/animations/RollingDie/RollingDie.tsx`:

1. In the `RollingDieProps` interface (around line 74), add after `valueColor?: string;`:

```ts
  size?: string;
```

2. In the function signature destructure (around line 96), add `size,` after `valueColor,`:

```ts
  valueColor,
  size,
```

3. Replace the hard-coded inline sizing (around line 118) with a `size` default:

```tsx
            style={{
              width: size ?? "clamp(64px, 14vw, 88px)",
              height: size ?? "clamp(64px, 14vw, 88px)",
              transformStyle: "preserve-3d",
            }}
```

- [ ] **Step 4: Write the component implementation**

Create `frontend/src/components/GuidanceBanner/GuidanceBanner.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import styles from "./GuidanceBanner.module.css";
import type { Color, GameState } from "@/lib/backgammon/engine";
import RollingDie from "@animations/RollingDie/RollingDie";
import { DiceRow } from "../Dice";
import { getGuidance } from "./guidance";
import type { GuidanceVariant } from "./guidance";

interface GuidanceBannerProps {
  state: GameState;
  playerColor: Color;
  onRoll: () => void;
  respondToDouble: (accept: boolean) => void;
}

function variantClass(variant: GuidanceVariant): string {
  switch (variant) {
    case "roll":
    case "move":
    case "confirm":
      return styles.accent;
    case "double":
    case "no-moves":
      return styles.danger;
    default:
      return styles.muted;
  }
}

export default function GuidanceBanner({
  state,
  playerColor,
  onRoll,
  respondToDouble,
}: GuidanceBannerProps) {
  const guidance = getGuidance(state, playerColor);
  const isOpening = state.phase === "opening_roll";

  const [rolling, setRolling] = useState(false);
  const [landOn, setLandOn] = useState<number[] | undefined>(undefined);
  const fired = useRef(false);

  // Land the rolling dice once the result arrives in the state.
  useEffect(() => {
    if (!rolling) return;
    let next: number[] | undefined;
    if (state.phase === "moving" && state.dice.length > 0) {
      next = state.dice;
    } else if (isOpening && state.openingRoll[playerColor] != null) {
      next = [state.openingRoll[playerColor]!];
    }
    if (next) setLandOn(next);
  }, [rolling, state.phase, state.dice, state.openingRoll, playerColor, isOpening]);

  function handleRollTap() {
    if (fired.current) return;
    fired.current = true;
    setRolling(true);
    setLandOn(undefined);
    window.setTimeout(() => onRoll(), 1000);
  }

  function handleRollComplete() {
    setRolling(false);
    setLandOn(undefined);
    fired.current = false;
  }

  if (!guidance) return null;

  return (
    <motion.div
      className={`${styles.banner} ${variantClass(guidance.variant)}`}
      data-testid="guidance-banner"
      data-variant={guidance.variant}
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {guidance.interactive === "roll" ? (
        <button
          type="button"
          className={styles.rollBtn}
          onClick={handleRollTap}
          data-testid="guidance-roll-btn"
        >
          <RollingDie
            rolling={rolling}
            count={isOpening ? 1 : 2}
            isOpening={isOpening}
            dark={playerColor === "black"}
            landOn={landOn}
            size="clamp(36px, 6vw, 48px)"
            onRollComplete={handleRollComplete}
          />
          <span className={styles.rollLabel}>
            {rolling ? "Rolling…" : "Tap to roll"}
          </span>
        </button>
      ) : guidance.interactive === "double" ? (
        <>
          <span className={styles.text}>{guidance.text}</span>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.accept}
              onClick={() => respondToDouble(true)}
              data-testid="double-accept"
            >
              Accept
            </button>
            <button
              type="button"
              className={styles.decline}
              onClick={() => respondToDouble(false)}
              data-testid="double-decline"
            >
              Decline
            </button>
          </div>
        </>
      ) : (
        <>
          {guidance.dice.length > 0 && (
            <DiceRow
              dice={guidance.dice}
              remaining={guidance.remaining}
              color={state.turn}
            />
          )}
          <span className={styles.text}>{guidance.text}</span>
        </>
      )}
    </motion.div>
  );
}
```

Create `frontend/src/components/GuidanceBanner/index.ts`:

```ts
export { default } from "./GuidanceBanner";
```

- [ ] **Step 5: Write the CSS module**

Create `frontend/src/components/GuidanceBanner/GuidanceBanner.module.css`:

```css
.banner {
  position: absolute;
  top: clamp(6px, 1.2vw, 14px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 45;
  display: flex;
  align-items: center;
  gap: clamp(8px, 1.2vw, 14px);
  max-width: calc(100% - 16px);
  padding: clamp(4px, 0.8vw, 10px) clamp(10px, 1.6vw, 18px);
  border-radius: clamp(10px, 1.6vw, 18px);
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(201, 169, 97, 0.3);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
}

.accent {
  border-color: var(--gold);
}

.danger {
  border-color: rgba(255, 107, 107, 0.6);
}

.muted {
  border-color: rgba(255, 255, 255, 0.18);
}

.text {
  color: rgba(255, 255, 255, 0.85);
  font-size: clamp(11px, 1.4vw, 14px);
  font-weight: 600;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

.rollBtn {
  display: flex;
  align-items: center;
  gap: clamp(6px, 1vw, 12px);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.rollLabel {
  color: var(--gold);
  font-size: clamp(11px, 1.3vw, 14px);
  font-weight: 700;
  animation: pulse 1.6s ease-in-out infinite;
}

.actions {
  display: flex;
  gap: 8px;
}

.accept,
.decline {
  padding: clamp(5px, 0.7vw, 8px) clamp(12px, 1.6vw, 18px);
  border-radius: 8px;
  font-size: clamp(12px, 1.4vw, 14px);
  font-weight: 700;
  cursor: pointer;
  border: none;
}

.accept {
  background: #16a34a;
  color: white;
}

.decline {
  background: #dc2626;
  color: white;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `frontend/`): `pnpm test GuidanceBanner`

Expected: PASS — all 9 tests green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/GuidanceBanner frontend/src/components/animations/RollingDie/RollingDie.tsx
git commit -m "feat: guidance banner component with unified roll/move/double prompts"
```

---

### Task 3: Wire the banner into `GameBoard`, remove old overlays

**Files:**
- Modify: `frontend/src/components/GameScreen/GameBoard.tsx`
- Test: `frontend/src/components/GameScreen/GameBoard.test.tsx`

- [ ] **Step 1: Rewrite `GameBoard.tsx`**

Replace the entire contents of `frontend/src/components/GameScreen/GameBoard.tsx`:

```tsx
import { useState, useMemo, useEffect } from "react";
import styles from "./GameScreen.module.css";
import { Board } from "../Board";
import SidePanel from "../SidePanel";
import GuidanceBanner from "../GuidanceBanner";
import { allLegalMoves, legalMovesFrom, type Source, type Target } from "@/lib/backgammon/engine";
import type { GameState, Color } from "@/lib/backgammon/engine";

interface GameBoardProps {
  state: GameState;
  playerColor: Color;
  makeMove: (from: Source, to: Target) => void;
  undoMove?: () => void;
  endTurn?: () => void;
  onLeave?: () => void;
  onRoll?: () => void;
  respondToDouble?: (accept: boolean) => void;
  clock?: Record<Color, number> | null;
  turnStartedAt?: number | null;
  timeControl?: import("../../lib/clock").TimeControl | null;
}

export default function GameBoard({
  state,
  playerColor,
  makeMove,
  undoMove,
  endTurn,
  onLeave,
  onRoll,
  respondToDouble,
  clock,
  turnStartedAt,
  timeControl,
}: GameBoardProps) {
  const [selected, setSelected] = useState<Source | null>(null);

  const isMyTurn = state.turn === playerColor && state.phase === "moving";

  useEffect(() => {
    if (!isMyTurn) setSelected(null);
  }, [isMyTurn]);

  const legalFromPoints = useMemo(() => {
    if (!isMyTurn || !state || !state.points) return [];
    const moves = allLegalMoves(state, playerColor);
    const unique = new Set<Source>();
    for (const m of moves) unique.add(m.from);
    return Array.from(unique);
  }, [state, playerColor, isMyTurn]);

  const legalTargets = useMemo(() => {
    if (!isMyTurn || !state || !state.points || selected === null) return [];
    const moves = legalMovesFrom(state, selected, playerColor);
    const unique = new Set<Target>();
    for (const m of moves) unique.add(m.to);
    return Array.from(unique);
  }, [state, selected, playerColor, isMyTurn]);

  function handleSelect(from: Source | null) {
    setSelected(from);
  }

  function handleMove(to: Target) {
    if (selected === null) return;
    makeMove(selected, to);
    setSelected(null);
  }

  return (
    <div className={styles.gameFrame} data-testid="board-frame">
      <div className={styles.boardArea}>
        <Board
          state={state}
          myColor={playerColor}
          selected={selected}
          legalTargets={legalTargets}
          onSelect={handleSelect}
          onMove={handleMove}
          legalFromPoints={legalFromPoints}
          onUndo={undoMove}
          onConfirm={endTurn}
        />
        <GuidanceBanner
          state={state}
          playerColor={playerColor}
          onRoll={onRoll ?? (() => {})}
          respondToDouble={respondToDouble ?? (() => {})}
        />
      </div>
      <SidePanel
        state={state}
        playerColor={playerColor}
        onLeave={onLeave}
        clock={clock}
        turnStartedAt={turnStartedAt}
        timeControl={timeControl}
      />
    </div>
  );
}
```

- [ ] **Step 2: Update the `GameBoard` test file**

Edit `frontend/src/components/GameScreen/GameBoard.test.tsx`:

1. Replace the `MountProps` interface (lines 29-39) and the `mountBoard` helper (lines 41-60) with:

```tsx
interface MountProps {
  state: GameState;
  playerColor: Color;
  makeMove?: (from: Source, to: Target) => void;
  undoMove?: () => void;
  endTurn?: () => void;
  onRoll?: () => void;
  respondToDouble?: (accept: boolean) => void;
}

async function mountBoard(mount: ComponentFixtures["mount"], props: MountProps) {
  const { state, playerColor, makeMove, undoMove, endTurn, onRoll, respondToDouble } = props;
  const component = await mount(
    <MockGameWrapper playerColor={playerColor} state={state}>
      <GameBoard
        state={state}
        playerColor={playerColor}
        makeMove={makeMove ?? (() => {})}
        undoMove={undoMove}
        endTurn={endTurn}
        onLeave={() => {}}
        onRoll={onRoll}
        respondToDouble={respondToDouble}
      />
    </MockGameWrapper>,
  );
  return component;
}
```

2. Replace the four dice-overlay tests (lines 120-148) with banner tests:

```tsx
test("banner shows dice during your moving phase with remaining dice", async ({ mount }) => {
  const state = movingState({ dice: [4, 3], remaining: [4, 3] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("guidance-banner")).toBeVisible();
  await expect(component.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "move");
  await expect(component.getByTestId("die")).toHaveCount(2);
});

test("banner shows opponent thinking (no dice) when it's not your turn", async ({ mount }) => {
  const state = movingState({ turn: "black", dice: [4, 3], remaining: [4, 3] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByText("Opponent is thinking…")).toBeVisible();
  await expect(component.getByTestId("die")).toHaveCount(0);
});

test("no dice overlay when phase is not moving", async ({ mount }) => {
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("die")).toHaveCount(0);
});

test("banner still present during rolling phase", async ({ mount }) => {
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("guidance-banner")).toBeVisible();
});
```

3. Replace the roll-prompt test (lines 150-160) with:

```tsx
test("banner shows the roll prompt when it's your turn in the rolling phase", async ({ mount }) => {
  const state = movingState({ phase: "rolling", turn: "white", dice: [], remaining: [] });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    onRoll: () => {},
  });

  await expect(component.getByTestId("guidance-banner")).toBeVisible();
  await expect(component.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "roll");
});
```

4. Delete the four doubling-cube-in-roll-prompt tests (lines 285-325). The doubling cube now lives only in the side panel `Controls`; replace them with one banner double-offer test:

```tsx
test("banner shows Accept/Decline when opponent offers a double", async ({ mount }) => {
  let accepted: boolean | null = null;
  const state = movingState({
    phase: "doubling_offered",
    turn: "white",
    doubleOfferedBy: "black",
    cube: 2,
    cubeOwner: "white",
  });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    respondToDouble: (a) => (accepted = a),
  });

  await expect(component.getByTestId("guidance-banner")).toHaveAttribute("data-variant", "double");
  await component.getByTestId("double-accept").click();
  await expect.poll(() => accepted).toBe(true);
});
```

- [ ] **Step 3: Run the GameBoard tests**

Run (from `frontend/`): `pnpm test GameBoard`

Expected: PASS — all remaining tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GameScreen/GameBoard.tsx frontend/src/components/GameScreen/GameBoard.test.tsx
git commit -m "feat: mount guidance banner in game board, remove roll/dice overlays"
```

---

### Task 4: Simplify `GameScreen` — remove old overlays and roll bookkeeping

**Files:**
- Modify: `frontend/src/components/GameScreen/GameScreen.tsx`
- Test: `frontend/src/components/GameScreen/GameScreen.test.tsx`

- [ ] **Step 1: Rewrite `GameScreen.tsx`**

Replace the entire contents of `frontend/src/components/GameScreen/GameScreen.tsx`:

```tsx
import styles from "./GameScreen.module.css";
import { useGame } from "../../services/gameContext";
import GameBoard from "./GameBoard";
import GameResultOverlay from "../GameResultOverlay/GameResultOverlay";

interface GameScreenProps {
  onLeave?: () => void;
}

export default function GameScreen({ onLeave }: GameScreenProps) {
  const {
    state,
    playerColor,
    isLoading,
    error,
    clearError,
    makeMove,
    rollDice,
    reconnected,
    opponentConnected,
    undoMove,
    endTurn,
    respondToDouble,
    clock,
    turnStartedAt,
    timeControl,
    gameResult,
    whiteName,
    blackName,
    handleNextGame,
    handleHome,
  } = useGame();

  if (isLoading) {
    return <div className={styles.loading}>Connecting to game...</div>;
  }

  if (!state) {
    if (error) {
      return <div className={styles.error}>Error: {error}</div>;
    }
    return <div className={styles.loading}>Initializing game...</div>;
  }

  return (
    <div className={styles.container}>
      {error && (
        <div className={styles.errorCard} data-testid="error-card" role="alert">
          <span>Error: {error}</span>
          <button
            type="button"
            className={styles.errorCardClose}
            data-testid="error-card-close"
            aria-label="Dismiss error"
            onClick={clearError}
          >
            ✕
          </button>
        </div>
      )}

      {gameResult && (
        <GameResultOverlay
          playerColor={playerColor}
          winner={gameResult.winner}
          winType={gameResult.winType}
          points={gameResult.points}
          cube={gameResult.cube}
          matchScore={gameResult.matchScore}
          matchTarget={gameResult.targetPoints}
          matchOver={gameResult.matchOver}
          reason={gameResult.reason}
          whiteName={whiteName}
          blackName={blackName}
          onNext={handleNextGame}
          onHome={onLeave || handleHome}
        />
      )}

      {!gameResult && (
        <>
          {reconnected && <div className={styles.reconnected}>Reconnected</div>}
          {!opponentConnected && !reconnected && (
            <div className={styles.disconnected}>
              Opponent disconnected — you can keep playing
            </div>
          )}

          <GameBoard
            state={state}
            playerColor={playerColor}
            makeMove={makeMove}
            undoMove={undoMove}
            endTurn={endTurn}
            onRoll={rollDice}
            respondToDouble={respondToDouble}
            onLeave={onLeave}
            clock={clock}
            turnStartedAt={turnStartedAt}
            timeControl={timeControl}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update the `GameScreen` test file**

Edit `frontend/src/components/GameScreen/GameScreen.test.tsx`:

1. Replace the "opening result overlay shows both dice and the winner" test (lines 7-29) with:

```tsx
test("opening result shows 'You go first!' in the guidance banner", async ({
  mount,
}) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "opening_result",
        turn: "white",
        openingRoll: { white: 5, black: 3 },
      })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("guidance-banner")).toHaveAttribute(
    "data-variant",
    "opening",
  );
  await expect(component.getByText("You go first!")).toBeVisible();
});
```

2. Replace the "opening roll prompt appears" test (lines 31-47) with:

```tsx
test("opening roll prompt appears in the banner for the player whose turn it is", async ({
  mount,
}) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "opening_roll",
        turn: "white",
        openingRoll: { white: null, black: null },
      })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByText("Roll to start")).toBeVisible();
  await expect(component.getByText("Tap to roll")).toBeVisible();
});
```

3. Replace the "roll prompt appears after a server auto-pass" test (lines 49-66) with:

```tsx
test("banner shows the roll prompt after a server auto-pass (stale dice in rolling state)", async ({
  mount,
}) => {
  const component = await mount(
    <MockGameWrapper
      playerColor="white"
      state={makeGameState({
        phase: "rolling",
        turn: "white",
        dice: [2, 4],
        remaining: [],
      })}
    >
      <GameScreen />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("guidance-banner")).toHaveAttribute(
    "data-variant",
    "roll",
  );
  await expect(component.getByText("Tap to roll")).toBeVisible();
});
```

The remaining tests (error card, fatal connection error) are unchanged.

- [ ] **Step 3: Run the GameScreen tests**

Run (from `frontend/`): `pnpm test GameScreen`

Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GameScreen/GameScreen.tsx frontend/src/components/GameScreen/GameScreen.test.tsx
git commit -m "feat: consolidate game screen prompts into guidance banner"
```

---

### Task 5: Remove Accept/Decline from `Controls`

**Files:**
- Modify: `frontend/src/components/Controls/Controls.tsx`

- [ ] **Step 1: Rewrite `Controls.tsx`**

Replace the entire contents of `frontend/src/components/Controls/Controls.tsx`:

```tsx
import styles from "./Controls.module.css";
import type { GameState, Color } from "@/lib/backgammon/engine";
import { useGame } from "../../services/gameContext";
import DoublingCube from "../DoublingCube";

interface ControlsProps {
  playerColor: Color;
  state: GameState;
}

export default function Controls({ playerColor, state }: ControlsProps) {
  const { offerDouble } = useGame();
  const isPlayerTurn = state.turn === playerColor;
  const canDouble =
    state.phase === "rolling" && isPlayerTurn;

  return (
    <div className={styles.controlsContainer}>
      <DoublingCube value={state.cube} owner={state.cubeOwner} />

      {canDouble && (
        <button
          className={`${styles.btn} ${styles.secondary}`}
          onClick={offerDouble}
          title="Offer double to opponent"
        >
          ✕2 Double
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify no test referenced the removed block**

Run (from `frontend/`): `grep -rn "doublePrompt\|respondToDouble" src/components/Controls src/components/SidePanel`

Expected: no matches (no `Controls.test.tsx` exists in this repo).

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run (from `frontend/`): `pnpm test`

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Controls/Controls.tsx
git commit -m "refactor: move double response buttons out of side panel controls"
```

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck + production build**

Run (from `frontend/`): `pnpm build`

Expected: PASS — `tsc` reports no errors, vite build completes.

- [ ] **Step 2: Lint**

Run (from `frontend/`): `pnpm lint`

Expected: no errors or warnings from changed files.

- [ ] **Step 3: Full test suite**

Run (from `frontend/`): `pnpm test`

Expected: all tests PASS.

- [ ] **Step 4: Manual smoke test**

Run (from `frontend/`): `pnpm dev`, then:
- Start a local match (`/local`): verify the banner shows "Roll to start" → "Your turn — tap a checker to move" with dice → "Confirm your turn" → "Opponent is thinking…" on the bot's turn.
- Start an online match (`/game/:roomId`): verify the banner behaves identically.
- Force a double offer in each mode and verify Accept/Decline appear in the banner and work.
- Resize to a mobile viewport and confirm the banner stays centered and readable over the top points.

- [ ] **Step 5: Commit any fixes produced during verification**

```bash
git add -A
git commit -m "fix: verification fixes for guidance banner"
```

(Only commit if step 4 surfaced changes; otherwise skip.)
