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
  rollResult?: number[];
  onRollLand?: () => void;
}

async function mountBoard(mount: ComponentFixtures["mount"], props: MountProps) {
  const { state, playerColor, makeMove, undoMove, endTurn, needsToRoll, onRoll, rollResult, onRollLand } = props;
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
        rollResult={rollResult}
        onRollLand={onRollLand}
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

test("no highlights and no moves when it is not the player's turn", async ({ mount }) => {
  const moveCalls: [Source, Target][] = [];
  const state = movingState({ turn: "black", phase: "moving" });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await expect(component.locator('[class*="highlight"]')).toHaveCount(0);

  await component.locator('[data-point-idx="23"]').click();
  await component.locator('[data-point-idx="19"]').click();
  await component.page().waitForTimeout(400);
  expect(moveCalls.length).toBe(0);
});

test("highlights appear for the active player's legal source points", async ({ mount }) => {
  const component = await mountBoard(mount, {
    state: simpleWhiteState(),
    playerColor: "white",
  });

  await expect(
    component.locator('[data-point-idx="23"] [class*="highlight"]'),
  ).toHaveCount(1);
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

test("board point order is mirrored for the black player", async ({ mount }) => {
  const state = simpleWhiteState();
  const component = await mount(
    <div>
      <div data-testid="white-board">
        <MockGameWrapper playerColor="white" state={state}>
          <GameBoard
            state={state}
            playerColor="white"
            makeMove={() => {}}
            onLeave={() => {}}
          />
        </MockGameWrapper>
      </div>
      <div data-testid="black-board">
        <MockGameWrapper playerColor="black" state={state}>
          <GameBoard
            state={state}
            playerColor="black"
            makeMove={() => {}}
            onLeave={() => {}}
          />
        </MockGameWrapper>
      </div>
    </div>,
  );

  const whiteOrder = await component
    .getByTestId("white-board")
    .locator("[data-point-idx]")
    .evaluateAll((els) =>
      els
        .map((el) => Number((el as HTMLElement).getAttribute("data-point-idx")))
        .filter((n) => Number.isInteger(n)),
    );
  const blackOrder = await component
    .getByTestId("black-board")
    .locator("[data-point-idx]")
    .evaluateAll((els) =>
      els
        .map((el) => Number((el as HTMLElement).getAttribute("data-point-idx")))
        .filter((n) => Number.isInteger(n)),
    );

  // White sees points 12..17, then 11..6 across the top rows and
  // 18..23, then 5..0 across the bottom rows, grouped around the bar.
  expect(whiteOrder).toEqual([
    12, 13, 14, 15, 16, 17,
    11, 10, 9, 8, 7, 6,
    18, 19, 20, 21, 22, 23,
    5, 4, 3, 2, 1, 0,
  ]);

  // Black sits opposite, so the top and bottom rows are swapped.
  expect(blackOrder).toEqual([
    11, 10, 9, 8, 7, 6,
    12, 13, 14, 15, 16, 17,
    5, 4, 3, 2, 1, 0,
    18, 19, 20, 21, 22, 23,
  ]);
});

test("doubling cube appears in the roll prompt on your turn", async ({ mount }) => {
  const state = movingState({ phase: "rolling", dice: [], remaining: [], cube: 2, cubeOwner: "white" });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    needsToRoll: true,
    onRoll: () => {},
  });

  await expect(component.getByTestId("roll-prompt")).toBeVisible();
  await expect(component.getByTestId("roll-prompt").getByTestId("doubling-cube")).toBeVisible();
});

test("doubling cube is hidden when it is not your turn", async ({ mount }) => {
  const state = movingState({ turn: "black", phase: "rolling", dice: [], remaining: [], cube: 2, cubeOwner: "black" });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    needsToRoll: true,
    onRoll: () => {},
  });

  await expect(component.getByTestId("roll-prompt")).toBeVisible();
  await expect(component.getByTestId("roll-prompt").getByTestId("doubling-cube")).toHaveCount(0);
});

test("roll prompt shows the actual dice result as landOn", async ({ mount }) => {
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  let landed = 0;
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    needsToRoll: true,
    onRoll: () => {},
    rollResult: [3, 5],
    onRollLand: () => landed++,
  });

  await expect(component.getByTestId("roll-prompt")).toBeVisible();
  await expect.poll(() => landed).toBeGreaterThanOrEqual(1);
});
