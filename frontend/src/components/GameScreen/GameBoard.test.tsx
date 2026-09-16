import { test, expect, type ComponentFixtures } from "@playwright/experimental-ct-react";
import type { ComponentProps } from "react";
import GameBoard from "./GameBoard";
import { MockGameWrapper } from "../../test-utils/wrappers";
import { applyMove, newGame, OFF } from "@/lib/backgammon/engine";
import type { GameState, Color, Source, Target } from "@/lib/backgammon/engine";
import type { NoMovesMessage } from "../../types/context";
import { Board } from "../Board/Board";

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
  makeMove?: ComponentProps<typeof GameBoard>["makeMove"];
  undoMove?: () => void;
  endTurn?: () => void;
  offerDouble?: () => void;
  needsToRoll?: boolean;
  onRoll?: () => void;
  respondToDouble?: (accept: boolean) => void;
  noMovesMessage?: NoMovesMessage | null;
}

async function mountBoard(mount: ComponentFixtures["mount"], props: MountProps) {
  const { state, playerColor, makeMove, undoMove, endTurn, offerDouble, needsToRoll, onRoll, respondToDouble, noMovesMessage } = props;
  const component = await mount(
    <MockGameWrapper playerColor={playerColor} state={state}>
      <GameBoard
        state={state}
        playerColor={playerColor}
        makeMove={makeMove ?? (() => {})}
        undoMove={undoMove}
        endTurn={endTurn}
        offerDouble={offerDouble}
        onLeave={() => {}}
        needsToRoll={needsToRoll}
        onRoll={onRoll}
        respondToDouble={respondToDouble}
        noMovesMessage={noMovesMessage}
      />
    </MockGameWrapper>,
  );
  await expect(component.locator('[data-point-idx="23"]')).toBeAttached();
  return component;
}

test("clicking a checker then a legal target calls makeMove", async ({ mount }) => {
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state: movingState({ dice: [4, 3], remaining: [4, 3] }),
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await component.locator('[data-point-idx="23"]').click();
  await component.locator('[data-point-idx="19"]').click();

  await expect.poll(() => moveCalls.length).toBe(1);
  expect(moveCalls[0]).toEqual([23, 19]);
});

test("tap uses the smaller die when bearing off immediately would waste a playable die", async ({ mount }) => {
  const state = movingState({ dice: [2, 1], remaining: [2, 1] });
  state.points = new Array(24).fill(0);
  state.points[1] = 1;
  state.home.white = 14;
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });
  await component.locator('[data-point-idx="1"]').click();
  await expect.poll(() => moveCalls.length).toBe(1);
  expect(moveCalls[0]).toEqual([1, 0]);
});

test("auto-moves on first tap when a checker has a single legal target", async ({ mount }) => {
  const moveCalls: [Source, Target][] = [];
  const state = simpleWhiteState();
  state.points[12] = 1; // Keep this tap test independent of the forced-turn timer.
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await component.locator('[data-point-idx="23"]').click();

  await expect.poll(() => moveCalls.length).toBe(1);
  expect(moveCalls[0]).toEqual([23, 19]);
});

test("auto-moves with the larger die when a checker has multiple legal targets", async ({ mount }) => {
  const moveCalls: [Source, Target][] = [];
  const state = movingState({ dice: [4, 3], remaining: [4, 3] });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await component.locator('[data-point-idx="23"]').click();
  await expect.poll(() => moveCalls.length).toBe(1);
  expect(moveCalls[0]).toEqual([23, 19]);
});

test("shows a forced-move message at the undo position before auto-moving", async ({
  mount,
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state: simpleWhiteState(),
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await expect(component.getByTestId("forced-move-notice")).toContainText(
    "Only one legal move — playing it automatically.",
  );
  await expect(component.getByTestId("dice-overlay").getByTestId("die")).toHaveCount(1);
  const readBox = (testId: string) =>
    component.getByTestId(testId).evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, width: box.width };
    });
  const boardBox = await component.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: box.x, width: box.width };
  });
  const noticeBox = await readBox("forced-move-notice");
  const diceBox = await readBox("dice-overlay");
  const boardMiddle = boardBox.x + boardBox.width / 2;
  expect(noticeBox.x + noticeBox.width / 2).toBeLessThan(boardMiddle);
  expect(diceBox.x + diceBox.width / 2).toBeGreaterThan(boardMiddle);
  expect(moveCalls).toHaveLength(0);

  await page.clock.runFor(349);
  expect(moveCalls).toHaveLength(0);
  await page.clock.runFor(1);
  await expect.poll(() => moveCalls.length).toBe(1);
  expect(moveCalls[0]).toEqual([23, 19]);

  await page.clock.runFor(5649);
  await expect(component.getByTestId("forced-move-notice")).toBeVisible();
  await page.clock.runFor(1);
  await expect(component.getByTestId("forced-move-notice")).toHaveCount(0);
});

for (const viewport of [{ width: 375, height: 812 }, { width: 740, height: 360 }, { width: 1280, height: 800 }]) {
  test(`notice keeps its anchor and undo stays usable (${viewport.width}px)`, async ({ mount, page }) => {
    await page.setViewportSize(viewport);
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let undoCalls = 0;
    const component = await mountBoard(mount, {
      state: movingState({ moveHistory: [{ ...simpleWhiteState() }] }),
      playerColor: "white",
      undoMove: () => undoCalls++,
    });
    const notice = component.getByTestId("forced-move-notice");
    await expect(notice).toBeVisible();
    const geometry = await notice.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const parent = (element as HTMLElement).offsetParent!.getBoundingClientRect();
      return { x: box.x + box.width / 2 - parent.x, y: box.y + box.height / 2 - parent.y,
        targetX: parent.width / 4, targetY: parent.height / 2 };
    });
    expect(geometry.x).toBeCloseTo(geometry.targetX, 0);
    expect(geometry.y).toBeCloseTo(geometry.targetY, 0);
    await expect(notice.locator("span").first()).toHaveCSS("pointer-events", "none");
    expect(await notice.locator("span").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    const undo = component.getByTitle("Undo last move");
    const noticeBox = await notice.boundingBox();
    const undoBox = await undo.boundingBox();
    expect(undoBox!.y).toBeGreaterThanOrEqual(noticeBox!.y + noticeBox!.height);
    await undo.click();
    await expect.poll(() => undoCalls).toBe(1);
    await expect(notice).toBeVisible();
  });
}

test("auto-moves with the smaller die after dice are reordered", async ({ mount }) => {
  const moveCalls: [Source, Target][] = [];
  const state = movingState({ dice: [4, 3], remaining: [3, 4] });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await component.locator('[data-point-idx="23"]').click();

  await expect.poll(() => moveCalls.length).toBe(1);
  expect(moveCalls[0]).toEqual([23, 20]);
});

test("source checker stays hidden during flight and reappears after", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const state = simpleWhiteState();
  state.points[12] = 1;
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
  });

  await component.locator('[data-point-idx="23"]').dispatchEvent("click");

  const sourceCheckers = component.locator('[data-point-idx="23"] [data-checker]');
  const flyer = component.locator('[data-testid="flying-checker"]');

  await expect(flyer).toHaveCount(1);
  await expect(sourceCheckers).toHaveCount(0);

  await page.clock.runFor(1400);

  await expect(flyer).toHaveCount(0);
  await expect(sourceCheckers).toHaveCount(1);
});

test("releases the board as soon as an authoritative move is applied", async ({
  mount,
  page,
}) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const initialState = simpleWhiteState();
  initialState.points[12] = 1;
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state: initialState,
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });
  const flyer = component.getByTestId("flying-checker");

  await component.locator('[data-point-idx="23"]').dispatchEvent("click");
  await expect.poll(() => moveCalls).toEqual([[23, 19]]);

  const points = [...initialState.points];
  points[23] = 0;
  points[19] = 1;
  const acknowledgedState = movingState({
    points,
    phase: "rolling",
    turn: "black",
    remaining: [],
    lastMove: [{ from: 23, to: 19 }],
    moveHistory: null,
  });
  await component.update(
    <MockGameWrapper playerColor="white" state={acknowledgedState}>
      <GameBoard
        state={acknowledgedState}
        playerColor="white"
        makeMove={() => {}}
        onLeave={() => {}}
      />
    </MockGameWrapper>,
  );
  await page.clock.runFor(350);

  expect(await flyer.count()).toBe(0);
  await expect(
    component.locator('[data-point-idx="19"] [data-checker]'),
  ).toHaveCount(1);
});

test("accepts the next move during an applied move's animation", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const points = new Array(24).fill(0);
  points[23] = 2;
  points[12] = 1;
  const initialState = movingState({ points, dice: [4, 3], remaining: [4, 3] });
  const moveCalls: [Source, Target][] = [];
  const makeMove = (from: Source, to: Target) => { moveCalls.push([from, to]); };
  const component = await mountBoard(mount, {
    state: initialState,
    playerColor: "white",
    makeMove,
  });

  await component.locator('[data-point-idx="23"]').dispatchEvent("click");
  await expect.poll(() => moveCalls.length).toBe(1);
  // A second click against an unchanged board must not duplicate the move.
  await component.locator('[data-point-idx="23"]').dispatchEvent("click");
  expect(moveCalls).toEqual([[23, 19]]);

  const appliedState = applyMove(initialState, { from: 23, to: 19, die: 4 }, "white");
  await component.update(
    <MockGameWrapper playerColor="white" state={appliedState}>
      <GameBoard state={appliedState} playerColor="white" makeMove={makeMove} />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("flying-checker")).toHaveCount(1);
  await expect(component.getByTestId("die").first().locator("span")).toHaveCount(3);
  await component.locator('[data-point-idx="23"]').dispatchEvent("click");
  await expect.poll(() => moveCalls.length).toBe(2);
  expect(moveCalls).toEqual([[23, 19], [23, 20]]);

  const finalState = applyMove(appliedState, { from: 23, to: 20, die: 3 }, "white");
  await component.update(
    <MockGameWrapper playerColor="white" state={finalState}>
      <GameBoard state={finalState} playerColor="white" makeMove={makeMove} />
    </MockGameWrapper>,
  );
  await page.clock.runFor(400);
  await expect(component.getByTestId("flying-checker")).toHaveCount(0);
  await expect(component.locator('[data-point-idx="19"] [data-checker]')).toHaveCount(1);
  await expect(component.locator('[data-point-idx="20"] [data-checker]')).toHaveCount(1);
});

for (const width of [375, 1280]) {
  for (const destinationCount of [0, 3, 5, -1]) {
    test(`flight lands exactly on the updated checker (${width}px, destination ${destinationCount})`, async ({ mount, page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.addStyleTag({ content: ":root { --checker: 30px; --bar-w: 30px; --bearoff-w: 40px; }" });
      await page.clock.install();
      await page.clock.pauseAt(new Date());
      const points = new Array(24).fill(0);
      points[23] = 2;
      points[12] = 2;
      points[19] = destinationCount;
      const state = movingState({ points, dice: [4, 3], remaining: [4, 3] });
      const component = await mountBoard(mount, { state, playerColor: "white" });

      await component.locator('[data-point-idx="23"]').dispatchEvent("click");
      // Keep the server response pending until the animation has landed.
      await page.clock.runFor(300);
      const landing = await component.getByTestId("flying-checker").boundingBox();
      expect(landing).not.toBeNull();

      const appliedState = applyMove(state, { from: 23, to: 19, die: 4 }, "white");
      await component.update(
        <MockGameWrapper playerColor="white" state={appliedState}>
          <GameBoard state={appliedState} playerColor="white" makeMove={() => {}} />
        </MockGameWrapper>,
      );
      await expect(component.getByTestId("die").first().locator("span")).toHaveCount(3);
      await page.clock.runFor(20);
      await expect(component.getByTestId("flying-checker")).toHaveCount(0);
      const checker = await component.locator('[data-point-idx="19"] [data-checker]').last().boundingBox();
      expect(checker).not.toBeNull();
      expect(Math.abs(landing!.x - checker!.x), "horizontal jump on landing").toBeLessThan(1);
      expect(Math.abs(landing!.y - checker!.y), "vertical jump on landing").toBeLessThan(1);
    });
  }
}

test("animates the opponent's first move and consecutive updates without leaving a stale flyer", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const points = new Array(24).fill(0);
  points[0] = -2;
  let state = movingState({ points, turn: "black", dice: [4, 3], remaining: [4, 3], lastMove: null });
  const component = await mountBoard(mount, { state, playerColor: "white" });
  const updateBoard = async () => {
    await component.update(
      <MockGameWrapper playerColor="white" state={state}>
        <GameBoard state={state} playerColor="white" makeMove={() => {}} />
      </MockGameWrapper>,
    );
  };
  state = applyMove(state, { from: 0, to: 4, die: 4 }, "black");
  await updateBoard();
  await expect(component.getByTestId("flying-checker")).toHaveCount(1);
  await expect(component.locator('[data-point-idx="4"] [data-checker]')).toHaveCount(0);

  state = applyMove(state, { from: 0, to: 3, die: 3 }, "black");
  await updateBoard();
  await expect(component.locator('[data-point-idx="4"] [data-checker]')).toHaveCount(1);
  await expect(component.locator('[data-point-idx="3"] [data-checker]')).toHaveCount(0);
  await page.clock.runFor(400);
  await expect(component.getByTestId("flying-checker")).toHaveCount(0);
  await expect(component.locator('[data-point-idx="3"] [data-checker]')).toHaveCount(1);
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
    state: movingState({ dice: [4, 3], remaining: [4, 3] }),
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });

  await component.locator('[data-point-idx="0"]').click();
  await component.locator('[data-point-idx="1"]').click();

  expect(moveCalls.length).toBe(0);
});

test("dice overlay shows during moving phase with remaining dice", async ({ mount }) => {
  const state = movingState({ dice: [4, 3], remaining: [4, 3] });
  const component = await mountBoard(mount, { state, playerColor: "white" });

  await expect(component.getByTestId("dice-overlay")).toBeVisible();
  await expect(component.getByTestId("die")).toHaveCount(2);
});

test("no-moves overlay shows the rolled dice and message", async ({ mount }) => {
  const state = movingState({
    phase: "rolling",
    turn: "white",
    dice: [2, 4],
    remaining: [],
    message: "No legal moves",
  });
  const component = await mountBoard(mount, {
    state,
    playerColor: "black",
    noMovesMessage: {
      dice: [2, 4],
      remaining: [2, 4],
      color: "white",
    },
  });

  await expect(component.getByTestId("no-moves-overlay")).toBeVisible();
  await expect(component.getByTestId("no-moves-overlay")).toContainText(
    "No legal moves — turn passes to your opponent.",
  );
  await expect(component.getByTestId("dice-overlay").getByTestId("die")).toHaveCount(2);
});

test("rolled dice render before the no-moves notice", async ({ mount }) => {
  const state = movingState({ phase: "rolling", turn: "black", dice: [], remaining: [] });
  const component = await mountBoard(mount, {
    state,
    playerColor: "black",
    noMovesMessage: {
      dice: [2, 4],
      remaining: [2, 4],
      color: "white",
      noticeVisible: false,
    },
  });

  await expect(component.getByTestId("dice-overlay").getByTestId("die")).toHaveCount(2);
  await expect(component.getByTestId("no-moves-overlay")).toHaveCount(0);

  await component.update(
    <MockGameWrapper state={state} playerColor="black">
      <GameBoard
        state={state}
        playerColor="black"
        makeMove={() => {}}
        noMovesMessage={{
          dice: [2, 4],
          remaining: [2, 4],
          color: "white",
          noticeVisible: true,
        }}
      />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("no-moves-overlay")).toBeVisible();
});

test("no-moves notice outlives the dice snapshot without delaying roll or double", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  let rolls = 0;
  let doubles = 0;
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    needsToRoll: true,
    onRoll: () => rolls++,
    offerDouble: () => doubles++,
    noMovesMessage: { dice: [2, 4], remaining: [2, 4], color: "black" },
  });
  await page.clock.runFor(350);
  await component.update(
    <MockGameWrapper state={state} playerColor="white">
      <GameBoard state={state} playerColor="white" makeMove={() => {}}
        needsToRoll onRoll={() => rolls++} offerDouble={() => doubles++} />
    </MockGameWrapper>,
  );
  await expect(component.getByTestId("dice-overlay")).toHaveCount(0);
  await component.getByTitle("Tap to roll").click();
  await component.getByTitle("Offer double to opponent").first().click();
  await expect.poll(() => rolls).toBe(1);
  await expect.poll(() => doubles).toBe(1);
  await page.clock.runFor(5649);
  await expect(component.getByTestId("no-moves-overlay")).toBeVisible();
  await page.clock.runFor(1);
  await expect(component.getByTestId("no-moves-overlay")).toHaveCount(0);
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

test("roll action appears where confirm sits when needsToRoll is set", async ({ mount }) => {
  let rolled = 0;
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    needsToRoll: true,
    onRoll: () => rolled++,
  });

  const rollBtn = component.getByTitle("Tap to roll");
  await expect(rollBtn).toBeVisible();
  await rollBtn.click();
  expect(rolled).toBe(1);
});

test("double action appears where undo sits at the start of a turn", async ({ mount }) => {
  let doubled = 0;
  const state = movingState({ phase: "rolling", dice: [], remaining: [] });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    needsToRoll: true,
    onRoll: () => {},
    offerDouble: () => doubled++,
  });

  const doubleBtn = component.getByTitle("Offer double to opponent").first();
  await expect(doubleBtn).toBeVisible();
  await expect(doubleBtn).toHaveText("Double");
  await doubleBtn.click();
  expect(doubled).toBe(1);
});

test("doubling cube sits on the bar and follows its owner from my perspective", async ({ mount }) => {
  const component = await mountBoard(mount, {
    state: movingState({ cube: 1, cubeOwner: "center" }),
    playerColor: "white",
  });

  const cubeSlot = component.getByTestId("bar-doubling-cube");
  await expect(cubeSlot).toHaveAttribute("data-cube-position", "center");
  await expect(cubeSlot.getByTestId("doubling-cube")).toHaveText("64");

  await component.update(
    <MockGameWrapper
      playerColor="white"
      state={movingState({ cube: 2, cubeOwner: "white" })}
    >
      <GameBoard
        state={movingState({ cube: 2, cubeOwner: "white" })}
        playerColor="white"
        makeMove={() => {}}
      />
    </MockGameWrapper>,
  );
  await expect(cubeSlot).toHaveAttribute("data-cube-position", "bottom");

  await component.update(
    <MockGameWrapper
      playerColor="white"
      state={movingState({ cube: 4, cubeOwner: "black" })}
    >
      <GameBoard
        state={movingState({ cube: 4, cubeOwner: "black" })}
        playerColor="white"
        makeMove={() => {}}
      />
    </MockGameWrapper>,
  );
  await expect(cubeSlot).toHaveAttribute("data-cube-position", "top");
});

test("undo button appears after a move and clicking calls undoMove", async ({ mount }) => {
  let undoCalled = 0;
  const state = movingState({
    moveHistory: [{ ...simpleWhiteState() }],
  });
  state.points[12] = 1;
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
    undoMove: () => undoCalled++,
  });

  const undoBtn = component.getByTitle("Undo last move");
  await expect(undoBtn).toBeVisible();
  await undoBtn.click();
  await expect.poll(() => undoCalled).toBe(1);
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

  await expect(component.getByTestId("white-board").locator("[data-point-idx]")).toHaveCount(26);
  await expect(component.getByTestId("black-board").locator("[data-point-idx]")).toHaveCount(26);
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
  await expect(component.getByTestId("doubling-cube")).toHaveText("4");
  await component.getByTestId("double-accept").click();
  await expect.poll(() => accepted).toBe(true);
});

test("match control drawer stays above dice and board actions", async ({ mount, page }) => {
  await page.setViewportSize({ width: 474, height: 330 });
  const state = movingState({
    phase: "moving",
    turn: "white",
    dice: [5, 3],
    remaining: [5, 3],
  });
  const component = await mountBoard(mount, {
    state,
    playerColor: "white",
  });

  await component.getByRole("button", { name: "Match control" }).click();
  const drawer = component.getByTestId("match-control-drawer");
  const dice = component.getByTestId("dice-overlay");
  await expect(drawer).toBeVisible();
  await expect(dice).toBeVisible();

  const drawerBox = await drawer.boundingBox();
  const diceBox = await dice.boundingBox();
  expect(drawerBox).not.toBeNull();
  expect(diceBox).not.toBeNull();
  const left = Math.max(drawerBox!.x, diceBox!.x);
  const right = Math.min(drawerBox!.x + drawerBox!.width, diceBox!.x + diceBox!.width);
  const top = Math.max(drawerBox!.y, diceBox!.y);
  const bottom = Math.min(drawerBox!.y + drawerBox!.height, diceBox!.y + diceBox!.height);
  expect(right).toBeGreaterThan(left);
  expect(bottom).toBeGreaterThan(top);

  const topLayer = await page.evaluate(
    ({ x, y }) =>
      document
        .elementFromPoint(x, y)
        ?.closest("[data-testid]")
        ?.getAttribute("data-testid"),
    { x: (left + right) / 2, y: (top + bottom) / 2 },
  );
  expect(topLayer).toBe("match-control-drawer");
});

// ---------------------------------------------------------------------------
// Bear-off orientation regression (viewer-relative trays) - corrected fixtures & real geometry
// ---------------------------------------------------------------------------

function bearOffRenderState(
  homeWhite: number,
  homeBlack: number,
  overrides: Partial<GameState> = {},
): GameState {
  const home = overrides.home ?? {
    white: homeWhite,
    black: homeBlack,
  };

  const bar = overrides.bar ?? {
    white: 0,
    black: 0,
  };

  const points: GameState["points"] =
    overrides.points !== undefined
      ? [...overrides.points]
      : new Array<number>(24).fill(0);

  if (overrides.points === undefined) {
    const remainingWhite = 15 - home.white - bar.white;
    const remainingBlack = 15 - home.black - bar.black;

    if (remainingWhite < 0 || remainingBlack < 0) {
      throw new Error(
        "Invalid bear-off fixture: home plus bar exceeds 15 checkers.",
      );
    }

    if (remainingWhite > 0) points[5] = remainingWhite;
    if (remainingBlack > 0) points[18] = -remainingBlack;
  }

  return {
    ...newGame(),
    phase: "moving",
    turn: "white",
    dice: [],
    remaining: [],
    lastMove: [],
    moveHistory: [],
    message: "",
    cube: 1,
    cubeOwner: "center",
    doubleOfferedBy: null,
    winner: null,
    winType: null,
    openingRoll: { white: null, black: null },
    ...overrides,
    home: { ...home },
    bar: { ...bar },
    points,
  };
}

function assertTotal15(state: GameState) {
  const boardWhite = state.points.filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const boardBlack = state.points.filter((v) => v < 0).reduce((s, v) => s + Math.abs(v), 0);
  expect(boardWhite + state.bar.white + state.home.white).toBe(15);
  expect(boardBlack + state.bar.black + state.home.black).toBe(15);
}

async function assertBearOffTray(
  component: Awaited<ReturnType<ComponentFixtures["mount"]>>,
  testId: "bear-off-top" | "bear-off-bottom",
  expected: { count: number; color: "white" | "black" },
) {
  const tray = component.getByTestId(testId);
  await expect(tray).toBeAttached();
  const countEl = tray.locator('[class*="count"]');
  await expect(countEl).toHaveText(String(expected.count));
  const whitePips = tray.locator('[class*="pipWhite"]');
  const blackPips = tray.locator('[class*="pipBlack"]');
  const allPips = tray.locator('[class*="checkerPip"]');
  await expect(allPips).toHaveCount(expected.count);
  if (expected.color === "white") {
    await expect(whitePips).toHaveCount(expected.count);
    await expect(blackPips).toHaveCount(0);
  } else {
    await expect(blackPips).toHaveCount(expected.count);
    await expect(whitePips).toHaveCount(0);
  }
}

async function getTrayGeometry(component: Awaited<ReturnType<ComponentFixtures["mount"]>>) {
  return await component.evaluate((root: HTMLElement) => {
    const getRect = (sel: string) => {
      const el = root.querySelector(sel) as HTMLElement | null;
      if (!el) throw new Error(`missing element ${sel}`);
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        throw new Error(`empty rect ${sel}`);
      }
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    };
    const top = getRect('[data-testid="bear-off-top"]');
    const bottom = getRect('[data-testid="bear-off-bottom"]');
    const off = getRect('[data-point-idx="off"]');
    if (top.cx === bottom.cx && top.cy === bottom.cy) throw new Error("trays share rect");
    return { top, bottom, off };
  });
}

async function getPointRect(component: Awaited<ReturnType<ComponentFixtures["mount"]>>, idx: number) {
  return await component.evaluate((root: HTMLElement, i: number) => {
    const el = root.querySelector(`[data-point-idx="${i}"]`) as HTMLElement | null;
    if (!el) throw new Error(`missing point ${i}`);
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) {
      throw new Error(`empty point rect ${i}`);
    }
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, idx);
}

function validBearOffWhiteState(die: number): GameState {
  // Non-winning: 13 borne off + 1 at 0 + 1 at 5 + 15 black at 23 = 15 each
  const points = new Array(24).fill(0);
  points[0] = 1;
  points[5] = 1;
  points[23] = -15;
  // die=1 bears off from 0
  return bearOffRenderState(13, 0, {
    points,
    turn: "white",
    dice: [die],
    remaining: [die],
    phase: "moving",
    lastMove: [],
    moveHistory: [],
  });
}

function validBearOffBlackState(die: number): GameState {
  const points = new Array(24).fill(0);
  points[23] = -1;
  points[18] = -1;
  points[0] = 15;
  return bearOffRenderState(0, 13, {
    points,
    turn: "black",
    dice: [die],
    remaining: [die],
    phase: "moving",
    lastMove: [],
    moveHistory: [],
  });
}

test("bear-off rendering: black viewer sees white on top (2) and black on bottom (3)", async ({ mount }) => {
  const state = bearOffRenderState(2, 3, { turn: "black", phase: "moving" });
  assertTotal15(state);
  const component = await mountBoard(mount, { state, playerColor: "black" });
  await assertBearOffTray(component, "bear-off-top", { count: 2, color: "white" });
  await assertBearOffTray(component, "bear-off-bottom", { count: 3, color: "black" });
  const { top, bottom } = await getTrayGeometry(component);
  expect(top.cy, "top tray should be physically above bottom").toBeLessThan(bottom.cy - 20);
});

test("bear-off rendering: white viewer sees black on top (3) and white on bottom (2)", async ({ mount }) => {
  const state = bearOffRenderState(2, 3, { turn: "white", phase: "moving" });
  assertTotal15(state);
  const component = await mountBoard(mount, { state, playerColor: "white" });
  await assertBearOffTray(component, "bear-off-top", { count: 3, color: "black" });
  await assertBearOffTray(component, "bear-off-bottom", { count: 2, color: "white" });
  const { top, bottom } = await getTrayGeometry(component);
  expect(top.cy).toBeLessThan(bottom.cy - 20);
});

test("bear-off fallback when myColor is null shows white bottom (white perspective)", async ({ mount }) => {
  const state = bearOffRenderState(2, 3, { turn: "white", phase: "moving" });
  assertTotal15(state);
  const component = await mount(
    <Board
      state={state}
      myColor={null}
      selected={null}
      legalTargets={[]}
      onSelect={() => {}}
      onMove={() => {}}
      legalFromPoints={[]}
    />,
  );
  await expect(component.getByTestId("bear-off-top")).toBeAttached();
  await assertBearOffTray(component, "bear-off-top", { count: 3, color: "black" });
  await assertBearOffTray(component, "bear-off-bottom", { count: 2, color: "white" });
  const { top, bottom } = await getTrayGeometry(component);
  expect(top.cy).toBeLessThan(bottom.cy - 20);
});

test("bear-off rerender updates bottom black count from 3 to 4 for black viewer", async ({ mount }) => {
  const initial = bearOffRenderState(2, 3, { turn: "black", phase: "moving" });
  assertTotal15(initial);
  const component = await mountBoard(mount, { state: initial, playerColor: "black" });
  await assertBearOffTray(component, "bear-off-top", { count: 2, color: "white" });
  await assertBearOffTray(component, "bear-off-bottom", { count: 3, color: "black" });

  const updated = bearOffRenderState(2, 4, { turn: "black", phase: "moving" });
  assertTotal15(updated);
  await component.update(
    <MockGameWrapper playerColor="black" state={updated}>
      <GameBoard state={updated} playerColor="black" makeMove={() => {}} onLeave={() => {}} />
    </MockGameWrapper>,
  );
  await assertBearOffTray(component, "bear-off-top", { count: 2, color: "white" });
  await assertBearOffTray(component, "bear-off-bottom", { count: 4, color: "black" });
  const { top, bottom } = await getTrayGeometry(component);
  expect(top.cy).toBeLessThan(bottom.cy - 20);
});

type SlotRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type FlyerCapture = { rect: SlotRect; cx: number; cy: number; width: number; height: number; color: string | null };

function expectedBottomSlotCenter(rect: SlotRect, stackIndex: number, checkerSize: number): { cx: number; cy: number } {
  return {
    cx: rect.left + rect.width / 2,
    cy: rect.bottom - 8 - stackIndex * (checkerSize + 2) - checkerSize / 2,
  };
}

async function installFlyerRemovalRecorder(
  component: Awaited<ReturnType<ComponentFixtures["mount"]>>,
): Promise<{ getCapture: () => Promise<FlyerCapture | null>; restore: () => Promise<void> }> {
  await component.evaluate((root: HTMLElement) => {
    const w = window as unknown as {
      __flyerCapture: FlyerCapture | null;
      __flyerOrig: typeof Node.prototype.removeChild | null;
      __flyerRoot: Element | null;
    };
    w.__flyerCapture = null;
    w.__flyerRoot = root;
    if (w.__flyerOrig) {
      Node.prototype.removeChild = w.__flyerOrig;
    }
    const orig = Node.prototype.removeChild;
    w.__flyerOrig = orig;
    Node.prototype.removeChild = function (this: Node, child: Node): Node {
      try {
        if (w.__flyerCapture === null && child instanceof Element) {
          let flyer: Element | null = null;
          if ((child as Element).matches('[data-testid="flying-checker"]')) {
            flyer = child as Element;
          } else {
            flyer = (child as Element).querySelector('[data-testid="flying-checker"]');
          }
          if (flyer && w.__flyerRoot && (w.__flyerRoot as Element).contains(flyer) && flyer.isConnected) {
            const rect = flyer.getBoundingClientRect();
            const colorEl = flyer.querySelector('[data-checker-color]');
            const color = colorEl ? colorEl.getAttribute('data-checker-color') : flyer.getAttribute('data-checker-color');
            w.__flyerCapture = {
              rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
              cx: rect.left + rect.width / 2,
              cy: rect.top + rect.height / 2,
              width: rect.width,
              height: rect.height,
              color: color as string | null,
            };
          }
        }
      } catch {
          /* intentionally ignored */
        }
      return (orig as unknown as (child: Node) => Node).call(this, child);
    } as unknown as typeof Node.prototype.removeChild;
  });
  return {
    getCapture: async () =>
      (await component.evaluate(() => (window as unknown as { __flyerCapture: FlyerCapture | null }).__flyerCapture)) as FlyerCapture | null,
    restore: async () => {
      await component.evaluate(() => {
        const w = window as unknown as {
          __flyerOrig: typeof Node.prototype.removeChild | null;
        };
        if (w.__flyerOrig) {
          Node.prototype.removeChild = w.__flyerOrig;
          w.__flyerOrig = null;
        }
      });
    },
  };
}

// --- Animation target tests - real geometry, precise centers ---

test("local white checker bears off to bottom tray (triggerFly)", async ({ mount }) => {
  const before = validBearOffWhiteState(1);
  assertTotal15(before);
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state: before,
    playerColor: "white",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });
  const { top, bottom, off } = await getTrayGeometry(component);
  const recorder = await installFlyerRemovalRecorder(component);
  try {
    await component.locator('[data-point-idx="0"]').click();
    await expect.poll(() => moveCalls.length).toBe(1);
    expect(moveCalls).toEqual([[0, OFF]]);
    await expect.poll(async () => await recorder.getCapture(), { timeout: 3000 }).not.toBeNull();
    const cap = (await recorder.getCapture())!;
    if (!cap) throw new Error("missing flyer capture for local white bear-off");
    expect(cap.color).toBe("white");
    const expected = expectedBottomSlotCenter(bottom, 0, cap.width);
    expect(Math.abs(cap.cx - expected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(cap.cy - expected.cy)).toBeLessThanOrEqual(2);
    const altTop = expectedBottomSlotCenter(top, 0, cap.width);
    expect(Math.abs(cap.cx - altTop.cx) > 2 || Math.abs(cap.cy - altTop.cy) > 2).toBeTruthy();
    const altOff = expectedBottomSlotCenter(off, 0, cap.width);
    if (Math.abs(altOff.cx - expected.cx) > 2 || Math.abs(altOff.cy - expected.cy) > 2) {
      expect(Math.abs(cap.cx - altOff.cx) > 2 || Math.abs(cap.cy - altOff.cy) > 2).toBeTruthy();
    }
    expect(moveCalls.length).toBe(1);
  } finally {
    await recorder.restore();
  }
});

test("local black checker bears off to bottom tray (triggerFly)", async ({ mount }) => {
  const before = validBearOffBlackState(1);
  assertTotal15(before);
  const moveCalls: [Source, Target][] = [];
  const component = await mountBoard(mount, {
    state: before,
    playerColor: "black",
    makeMove: (from, to) => moveCalls.push([from, to]),
  });
  const { top, bottom, off } = await getTrayGeometry(component);
  const recorder = await installFlyerRemovalRecorder(component);
  try {
    await component.locator('[data-point-idx="23"]').click();
    await expect.poll(() => moveCalls.length).toBe(1);
    expect(moveCalls).toEqual([[23, OFF]]);
    await expect.poll(async () => await recorder.getCapture(), { timeout: 3000 }).not.toBeNull();
    const cap = (await recorder.getCapture())!;
    if (!cap) throw new Error("missing flyer capture for local black bear-off");
    expect(cap.color).toBe("black");
    const expected = expectedBottomSlotCenter(bottom, 0, cap.width);
    expect(Math.abs(cap.cx - expected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(cap.cy - expected.cy)).toBeLessThanOrEqual(2);
    const altTop = expectedBottomSlotCenter(top, 0, cap.width);
    expect(Math.abs(cap.cx - altTop.cx) > 2 || Math.abs(cap.cy - altTop.cy) > 2).toBeTruthy();
    const altOff = expectedBottomSlotCenter(off, 0, cap.width);
    if (Math.abs(altOff.cx - expected.cx) > 2 || Math.abs(altOff.cy - expected.cy) > 2) {
      expect(Math.abs(cap.cx - altOff.cx) > 2 || Math.abs(cap.cy - altOff.cy) > 2).toBeTruthy();
    }
    expect(moveCalls.length).toBe(1);
  } finally {
    await recorder.restore();
  }
});

test("opponent white bears off observed by black viewer lands in top tray (animateExternalMove)", async ({ mount }) => {
  const before = validBearOffWhiteState(1);
  assertTotal15(before);
  const component = await mountBoard(mount, { state: { ...before, turn: "white", phase: "moving", lastMove: [] }, playerColor: "black" });
  const { top, bottom, off } = await getTrayGeometry(component);
  const after = applyMove(before, { from: 0, to: OFF, die: 1 }, "white");
  assertTotal15(after);
  const recorder = await installFlyerRemovalRecorder(component);
  try {
    await component.update(
      <MockGameWrapper playerColor="black" state={after}>
        <GameBoard state={after} playerColor="black" makeMove={() => {}} onLeave={() => {}} />
      </MockGameWrapper>,
    );
    await expect.poll(async () => await recorder.getCapture(), { timeout: 3000 }).not.toBeNull();
    const cap = (await recorder.getCapture())!;
    if (!cap) throw new Error("missing flyer capture for opponent white bear-off");
    expect(cap.color).toBe("white");
    const topPip = component.getByTestId("bear-off-top").locator('[class*="checkerPip"]').last();
    const topPipBox = await topPip.boundingBox();
    if (!topPipBox) throw new Error("missing top tray pip");
    const expected = { cx: topPipBox.x + topPipBox.width / 2, cy: topPipBox.y + topPipBox.height / 2 };
    expect(Math.abs(cap.cx - expected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(cap.cy - expected.cy)).toBeLessThanOrEqual(2);
    const altBottom = expectedBottomSlotCenter(bottom, 0, cap.width);
    const altOff = expectedBottomSlotCenter(off, 0, cap.width);
    expect(Math.abs(expected.cx - altBottom.cx) > 2 || Math.abs(expected.cy - altBottom.cy) > 2).toBeTruthy();
    expect(Math.abs(expected.cx - altOff.cx) > 2 || Math.abs(expected.cy - altOff.cy) > 2).toBeTruthy();
    expect(Math.abs(cap.cx - altBottom.cx) > 2 || Math.abs(cap.cy - altBottom.cy) > 2).toBeTruthy();
    expect(Math.abs(cap.cx - altOff.cx) > 2 || Math.abs(cap.cy - altOff.cy) > 2).toBeTruthy();
  } finally {
    await recorder.restore();
  }
});

test("opponent black bears off observed by white viewer lands in top tray (animateExternalMove)", async ({ mount }) => {
  const before = validBearOffBlackState(1);
  assertTotal15(before);
  const component = await mountBoard(mount, { state: { ...before, turn: "black", phase: "moving", lastMove: [] }, playerColor: "white" });
  const { top, bottom, off } = await getTrayGeometry(component);
  const after = applyMove(before, { from: 23, to: OFF, die: 1 }, "black");
  assertTotal15(after);
  const recorder = await installFlyerRemovalRecorder(component);
  try {
    await component.update(
      <MockGameWrapper playerColor="white" state={after}>
        <GameBoard state={after} playerColor="white" makeMove={() => {}} onLeave={() => {}} />
      </MockGameWrapper>,
    );
    await expect.poll(async () => await recorder.getCapture(), { timeout: 3000 }).not.toBeNull();
    const cap = (await recorder.getCapture())!;
    if (!cap) throw new Error("missing flyer capture for opponent black bear-off");
    expect(cap.color).toBe("black");
    const topPip = component.getByTestId("bear-off-top").locator('[class*="checkerPip"]').last();
    const topPipBox = await topPip.boundingBox();
    if (!topPipBox) throw new Error("missing top tray pip");
    const expected = { cx: topPipBox.x + topPipBox.width / 2, cy: topPipBox.y + topPipBox.height / 2 };
    expect(Math.abs(cap.cx - expected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(cap.cy - expected.cy)).toBeLessThanOrEqual(2);
    const altBottom = expectedBottomSlotCenter(bottom, 0, cap.width);
    const altOff = expectedBottomSlotCenter(off, 0, cap.width);
    expect(Math.abs(expected.cx - altBottom.cx) > 2 || Math.abs(expected.cy - altBottom.cy) > 2).toBeTruthy();
    expect(Math.abs(expected.cx - altOff.cx) > 2 || Math.abs(expected.cy - altOff.cy) > 2).toBeTruthy();
    expect(Math.abs(cap.cx - altBottom.cx) > 2 || Math.abs(cap.cy - altBottom.cy) > 2).toBeTruthy();
    expect(Math.abs(cap.cx - altOff.cx) > 2 || Math.abs(cap.cy - altOff.cy) > 2).toBeTruthy();
  } finally {
    await recorder.restore();
  }
});

test("undo of local white bear-off starts from bottom tray (handleUndo)", async ({ mount, page }) => {
  const clockStart = new Date("2024-01-01T00:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart);
  const before = validBearOffWhiteState(1);
  const after = applyMove(before, { from: 0, to: OFF, die: 1 }, "white");
  assertTotal15(after);
  let undoCalled = 0;
  const component = await mountBoard(mount, {
    state: { ...after, turn: "white", phase: "moving", dice: [], remaining: [], lastMove: [{ from: 0, to: OFF }], moveHistory: [before], message: "White — confirm" } as GameState,
    playerColor: "white",
    undoMove: () => undoCalled++,
  });
  const recorder = await installFlyerRemovalRecorder(component);
  try {
    const { bottom } = await getTrayGeometry(component);
    const pointRectBefore = await getPointRect(component, 0);
    const undoBtn = component.getByTitle("Undo last move");
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    await expect.poll(() => undoCalled).toBe(1);
    const flyer = component.getByTestId("flying-checker");
    await expect(flyer).toHaveCount(1);
    const startBox = await flyer.boundingBox();
    if (!startBox) throw new Error("missing flyer boundingBox for undo white start");
    const startCenter = { cx: startBox.x + startBox.width / 2, cy: startBox.y + startBox.height / 2 };
    const startExpected = expectedBottomSlotCenter(bottom, 4, startBox.width);
    expect(Math.abs(startCenter.cx - startExpected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(startCenter.cy - startExpected.cy)).toBeLessThanOrEqual(2);
    expect(startCenter.cy).toBeGreaterThan(bottom.top - 2);
    expect(startCenter.cy).toBeLessThan(bottom.bottom + 2);
    expect(startCenter.cx).toBeGreaterThan(bottom.left - 2);
    expect(startCenter.cx).toBeLessThan(bottom.right + 2);
    await page.clock.resume();
    await expect.poll(async () => await recorder.getCapture(), { timeout: 3000 }).not.toBeNull();
    const cap = (await recorder.getCapture())!;
    if (!cap) throw new Error("missing flyer capture for undo white end");
    expect(cap.color).toBe("white");
    const endExpected = expectedBottomSlotCenter(pointRectBefore, 0, cap.width);
    expect(Math.abs(cap.cx - endExpected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(cap.cy - endExpected.cy)).toBeLessThanOrEqual(2);
    expect(undoCalled).toBe(1);
  } finally {
    await recorder.restore();
  }
});

test("undo of local black bear-off starts from bottom tray (handleUndo)", async ({ mount, page }) => {
  const clockStart = new Date("2024-01-01T00:00:00Z");
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart);
  const before = validBearOffBlackState(1);
  const after = applyMove(before, { from: 23, to: OFF, die: 1 }, "black");
  assertTotal15(after);
  let undoCalled2 = 0;
  const component = await mountBoard(mount, {
    state: { ...after, turn: "black", phase: "moving", dice: [], remaining: [], lastMove: [{ from: 23, to: OFF }], moveHistory: [before], message: "Black — confirm" } as GameState,
    playerColor: "black",
    undoMove: () => undoCalled2++,
  });
  const recorder = await installFlyerRemovalRecorder(component);
  try {
    const { bottom } = await getTrayGeometry(component);
    const pointRectBefore = await getPointRect(component, 23);
    const undoBtn = component.getByTitle("Undo last move");
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    await expect.poll(() => undoCalled2).toBe(1);
    const flyer = component.getByTestId("flying-checker");
    await expect(flyer).toHaveCount(1);
    const startBox = await flyer.boundingBox();
    if (!startBox) throw new Error("missing flyer boundingBox for undo black start");
    const startCenter = { cx: startBox.x + startBox.width / 2, cy: startBox.y + startBox.height / 2 };
    const startExpected = expectedBottomSlotCenter(bottom, 4, startBox.width);
    expect(Math.abs(startCenter.cx - startExpected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(startCenter.cy - startExpected.cy)).toBeLessThanOrEqual(2);
    expect(startCenter.cy).toBeGreaterThan(bottom.top - 2);
    expect(startCenter.cy).toBeLessThan(bottom.bottom + 2);
    expect(startCenter.cx).toBeGreaterThan(bottom.left - 2);
    expect(startCenter.cx).toBeLessThan(bottom.right + 2);
    await page.clock.resume();
    await expect.poll(async () => await recorder.getCapture(), { timeout: 3000 }).not.toBeNull();
    const cap = (await recorder.getCapture())!;
    if (!cap) throw new Error("missing flyer capture for undo black end");
    expect(cap.color).toBe("black");
    const endExpected = expectedBottomSlotCenter(pointRectBefore, 0, cap.width);
    expect(Math.abs(cap.cx - endExpected.cx)).toBeLessThanOrEqual(2);
    expect(Math.abs(cap.cy - endExpected.cy)).toBeLessThanOrEqual(2);
    expect(undoCalled2).toBe(1);
  } finally {
    await recorder.restore();
  }
});

// --- Forced auto-confirm: provenance and UI ---
test("forced autoMove dispatched as forced", async ({ mount, page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const forcedCalls: Array<{from: Source, to: Target, origin?: string}> = [];
  const state = movingState({ dice: [4], remaining: [4], points: (()=>{ const p=new Array(24).fill(0); p[23]=1; return p;})() });
  await mountBoard(mount, { state, playerColor: "white", makeMove: (from, to, options) => {
  forcedCalls.push({
    from,
    to,
    origin: options?.origin,
  });
} });
  await page.clock.runFor(400);
  await expect.poll(()=> forcedCalls.length).toBe(1);
  expect(forcedCalls[0].origin).toBe("forced");
});

test("manual click is manual", async ({ mount }) => {
  const manualCalls: Array<{from: Source, to: Target, origin?: string}> = [];
  const manualState = movingState({ dice: [4,3], remaining: [4,3], points: (()=>{ const p=new Array(24).fill(0); p[23]=1; p[12]=1; return p;})() });
  const component = await mountBoard(mount, { state: manualState, playerColor: "white", makeMove: (from, to, options) => {
  manualCalls.push({
    from,
    to,
    origin: options?.origin,
  });
} });
  await component.locator('[data-point-idx="23"]').click();
  await component.locator('[data-point-idx="19"]').click();
  await expect.poll(()=> manualCalls.length).toBe(1);
  expect(manualCalls[0].origin).not.toBe("forced");
});

test("terminal forced move shows confirm when not pending", async ({ mount }) => {
  const state = movingState({ dice: [], remaining: [], moveHistory: [{...simpleWhiteState()}] });
  const component = await mountBoard(mount, { state, playerColor: "white", endTurn: ()=>{}, undoMove: ()=>{} });
  await expect(component.getByTitle("Confirm and end your turn")).toBeVisible();
});

test("terminal forced move hides confirm and blocks input when pending", async ({ mount }) => {
  const state = movingState({ dice: [], remaining: [], moveHistory: [{...simpleWhiteState()}] });
  const component = await mount(
    <MockGameWrapper playerColor="white" state={state}>
      <GameBoard state={state} playerColor="white" makeMove={()=>{}} endTurn={()=>{}} undoMove={()=>{}} autoConfirmPending={true} />
    </MockGameWrapper>
  );
  await expect(component.getByTitle("Confirm and end your turn")).toHaveCount(0);
  await expect(component.getByTitle("Undo last move")).toHaveCount(0);
});

test("forced autoMove resumes after animation without duplicate", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2024-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2024-01-01T00:00:00Z"));
  const state = movingState({ dice: [4], remaining: [4], points: (()=>{ const p=new Array(24).fill(0); p[23]=1; return p;})() });
  const calls: Array<[Source,Target]> = [];
  const comp = await mountBoard(mount, { state, playerColor: "white", makeMove: (f,t)=> calls.push([f,t]) });
  // trigger a manual move to create flyChecker, then schedule forced autoMove while animating
  await comp.locator('[data-point-idx="23"]').dispatchEvent("click");
  await expect(comp.getByTestId("flying-checker")).toHaveCount(1);
  // Flying checker: 220ms animation + 600ms committed timeout = 820ms
  await page.clock.runFor(1000);
  await expect(comp.getByTestId("flying-checker")).toHaveCount(0);
  expect(calls.length).toBe(1);
});

test("GameBoard no-moves overlay renders Hebrew with rtl dir", async ({ mount, page }) => {
  await page.evaluate(() => localStorage.setItem("backgammon-game-locale", "he"));
  const state = movingState({
    phase: "rolling",
    turn: "white",
    dice: [2, 4],
    remaining: [],
    message: "No legal moves",
  });
  const component = await mountBoard(mount, {
    state,
    playerColor: "black",
    noMovesMessage: {
      dice: [2, 4],
      remaining: [2, 4],
      color: "white",
    },
  });
  // reload to pick up he locale from localStorage
  await page.evaluate(() => localStorage.setItem("backgammon-game-locale", "he"));
  const heComponent = await mountBoard(mount, {
    state,
    playerColor: "black",
    noMovesMessage: {
      dice: [2, 4],
      remaining: [2, 4],
      color: "white",
    },
  });
  const textEl = heComponent.getByTestId("no-moves-overlay").locator("span").first();
  // The actual visible no-moves message should be the Hebrew one
  await expect(heComponent.getByTestId("no-moves-overlay")).toContainText("אין מהלכים חוקיים — התור עובר ליריב.");
  // Check that the underlying GuidanceBanner text element has dir rtl and lang he
  const bannerText = heComponent.getByTestId("guidance-banner").locator('[class*="text"]').first();
  // Fallback: if not found via guidance-banner, check the overlay's span
  const target = (await bannerText.count()) > 0 ? bannerText : textEl;
  await expect(target).toHaveAttribute("dir", "rtl");
  await expect(target).toHaveAttribute("lang", "he");
  const content = await target.textContent();
  expect(content).toBe("אין מהלכים חוקיים — התור עובר ליריב.");
  expect(content?.endsWith("היריב.")).toBe(true);
});

test("stale forced command with same from/to but no longer forced is not dispatched", async ({ mount, page }) => {
  await page.clock.install({ time: new Date("2024-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2024-01-01T00:00:00Z"));
  const initial = movingState({ dice: [4], remaining: [4], points: (() => { const p = new Array(24).fill(0); p[23] = 1; return p; })() });
  const calls: Array<[Source, Target]> = [];
  const component = await mountBoard(mount, { state: initial, playerColor: "white", makeMove: (f, t) => calls.push([f, t]) });
  // trigger a manual move to create flyChecker and defer forced command
  await component.locator('[data-point-idx="23"]').dispatchEvent("click");
  await expect(component.getByTestId("flying-checker")).toHaveCount(1);
  // while animation is active, change position so old forced move is still legal but no longer forced (add alternative placement)
  const altered = movingState({ dice: [4], remaining: [4], points: (() => { const p = new Array(24).fill(0); p[23] = 1; p[12] = 1; return p; })() });
  await component.update(
    <MockGameWrapper playerColor="white" state={altered}>
      <GameBoard state={altered} playerColor="white" makeMove={(f, t) => calls.push([f, t])} />
    </MockGameWrapper>,
  );
  await page.clock.runFor(1000);
  await expect(component.getByTestId("flying-checker")).toHaveCount(0);
  // old forced command should have been invalidated, not dispatched
  expect(calls.length).toBe(1);
});
