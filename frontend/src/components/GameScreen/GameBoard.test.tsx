import { test, expect, type ComponentFixtures } from "@playwright/experimental-ct-react";
import GameBoard from "./GameBoard";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { newGame } from "@/lib/backgammon/engine";
import type { GameState, Color, Source, Target } from "@/lib/backgammon/engine";

function simpleWhiteState(): GameState {
  const points = new Array(24).fill(0);
  points[23] = 1;
  return {
    ...newGame(),
    points,
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    phase: "moving",
    turn: "white",
    dice: [4],
    remaining: [4],
    lastMove: [],
    moveHistory: [],
    message: "White — make a move",
  };
}

function movingState(overrides: Partial<GameState> = {}): GameState {
  return { ...simpleWhiteState(), ...overrides };
}

interface MountProps {
  state: GameState;
  playerColor: Color;
  makeMove?: (from: Source, to: Target) => void;
  undoMove?: () => void;
  endTurn?: () => void;
  needsToRoll?: boolean;
  onRoll?: () => void;
}

async function mountBoard(mount: ComponentFixtures["mount"], props: MountProps) {
  const { state, playerColor, makeMove, undoMove, endTurn, needsToRoll, onRoll } = props;
  const component = await mount(
    <MockGameWrapper playerColor={playerColor} state={state}>
      <GameBoard
        state={state}
        playerColor={playerColor}
        makeMove={makeMove ?? (() => {})}
        undoMove={undoMove}
        endTurn={endTurn}
        onLeave={() => {}}
        needsToRoll={needsToRoll}
        onRoll={onRoll}
      />
    </MockGameWrapper>,
  );
  return component;
}

test("clicking a checker then a legal target calls makeMove", async ({ mount }) => {
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state: simpleWhiteState(),
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await component.locator('[data-point-idx="23"]').click();
  await component.locator('[data-point-idx="19"]').click();

  await expect.poll(() => moveCalls.length).toBe(1);
  expect(moveCalls[0]).toEqual([23, 19]);
});

test("clicking an illegal point does not call makeMove", async ({ mount }) => {
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state: simpleWhiteState(),
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await component.locator('[data-point-idx="0"]').click();
  await component.locator('[data-point-idx="1"]').click();

  await component.page().waitForTimeout(400);
  expect(moveCalls.length).toBe(0);
});

test("dice overlay shows during moving phase with remaining dice", async ({ mount }) => {
  const state = movingState({ dice: [4, 3], remaining: [4, 3] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("dice-overlay")).toBeVisible();
  await expect(component.getByTestId("die")).toHaveCount(2);
});

test("dice overlay is visible to the opponent when it's their turn", async ({ mount }) => {
  const state = movingState({ turn: "black", dice: [4, 3], remaining: [4, 3] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("dice-overlay")).toBeVisible();
  await expect(component.getByTestId("die")).toHaveCount(2);
});

test("no dice overlay when phase is not moving", async ({ mount }) => {
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("dice-overlay")).toHaveCount(0);
});

test("no dice overlay during opening roll", async ({ mount }) => {
  const state = movingState({ phase: "opening_roll", dice: [], remaining: [] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("dice-overlay")).toHaveCount(0);
});

test("roll prompt appears when needsToRoll is set", async ({ mount }) => {
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    needsToRoll: true,
    onRoll: () => {},
  });

  await expect(component.getByTestId("roll-prompt")).toBeVisible();
});

test("undo button appears after a move and clicking calls undoMove", async ({ mount }) => {
  let undoCalled = 0;
  const state = movingState({
    moveHistory: [{ ...simpleWhiteState() }],
  });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    undoMove: () => undoCalled++,
  });

  const undoBtn = component.getByTitle("Undo last move");
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  expect(undoCalled).toBe(1);
});

test("no undo button before any move is made", async ({ mount }) => {
  const component = await mountBoard(mount, {
    state: simpleWhiteState(),
    playerColor: "white",
    undoMove: () => {},
  });

  await expect(component.getByTitle("Undo last move")).toHaveCount(0);
});

test("confirm button appears when dice are spent on your turn and clicking calls endTurn", async ({ mount }) => {
  let endTurnCalled = 0;
  const state = movingState({
    remaining: [],
    dice: [],
    moveHistory: [{ ...simpleWhiteState() }],
  });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    endTurn: () => endTurnCalled++,
  });

  const confirmBtn = component.getByTitle("Confirm and end your turn");
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();
  expect(endTurnCalled).toBe(1);
});

test("no confirm button when it is not your turn", async ({ mount }) => {
  const state = movingState({
    turn: "black",
    remaining: [],
    dice: [],
  });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    endTurn: () => {},
  });

  await expect(component.getByTitle("Confirm and end your turn")).toHaveCount(0);
});
