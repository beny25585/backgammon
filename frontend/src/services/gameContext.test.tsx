import {
  test,
  expect,
  type ComponentFixtures,
} from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { GameProvider } from "./gameContext";
import { GameProbe } from "../test-utils/probes";
import GameScreen from "../components/GameScreen/GameScreen";
import type { GameState } from "../lib/backgammon/engine";
import { newGame } from "../lib/backgammon/engine";

interface FakeSocket {
  sent: string[];
  emit: (message: unknown) => void;
}

interface WsMessage {
  type: string;
  payload?: Record<string, unknown>;
}

function midGameState(): GameState {
  const points = new Array(24).fill(0);
  points[23] = 1; // white checker on point 23, die 4 can move it to 19.
  return {
    ...newGame(),
    points,
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    turn: "white",
    dice: [4],
    remaining: [4],
    phase: "moving",
    lastMove: [],
    moveHistory: [],
    message: "White — make a move",
    version: 1,
  };
}

function rollingState(): GameState {
  return { ...midGameState(), phase: "rolling", dice: [], remaining: [] };
}

async function seedFakeSocket(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("bg_access_token", "test-token");
    const w = window as unknown as Record<string, unknown>;
    class FakeWebSocket {
      readyState = 1; // OPEN
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      sent: string[] = [];
      constructor(_url: string) {
        w.__fakeWs = this;
        setTimeout(() => this.onopen?.(), 0);
      }
      send(data: string) {
        this.sent.push(data);
      }
      close() {
        this.readyState = 3;
        this.onclose?.();
      }
      emit(message: unknown) {
        this.onmessage?.({ data: JSON.stringify(message) });
      }
    }
    Object.assign(FakeWebSocket, {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
    });
    w.WebSocket = FakeWebSocket;
  });
}

async function sentMessages(page: Page): Promise<WsMessage[]> {
  return page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    return (ws?.sent ?? []).map((s) => JSON.parse(s) as WsMessage);
  });
}

async function emitInitialState(page: Page, state: GameState) {
  await page.evaluate((s) => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({
      type: "state_update",
      payload: s,
      playerColor: "white",
      initial: true,
      players: { white: "whiteUser", black: "blackUser" },
      timeControl: "none",
    });
  }, state);
}

async function emitBroadcast(page: Page, state: GameState) {
  await page.evaluate((s) => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({
      type: "state_update",
      payload: s,
      playerColor: "white",
      initial: false,
    });
  }, state);
}

async function emitGameEnded(page: Page, payload: Record<string, unknown>) {
  await page.evaluate((p) => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({ type: "game_ended", payload: p });
  }, payload);
}

async function mountProbe(
  mount: ComponentFixtures["mount"],
  page: Page,
): Promise<ReturnType<ComponentFixtures["mount"]>> {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await expect(component.getByTestId("loading")).toHaveText("false");
  return component;
}

test("roll sends a roll intent without shipping game state", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...rollingState(), version: 1 });

  await component.getByTestId("roll").click();

  await expect
    .poll(
      async () =>
        (await sentMessages(page)).some((m) => m.payload?.action === "roll"),
      { timeout: 3000 },
    )
    .toBe(true);
  const rollMsg = (await sentMessages(page)).find(
    (m) => m.payload?.action === "roll",
  )!;
  expect(rollMsg.payload).not.toHaveProperty("state");
  expect(rollMsg.payload).toEqual({ action: "roll" });
});

test("server roll broadcast applies dice to the board", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...rollingState(), version: 1 });

  await component.getByTestId("roll").click();
  await expect
    .poll(
      async () =>
        (await sentMessages(page)).some((m) => m.payload?.action === "roll"),
      { timeout: 3000 },
    )
    .toBe(true);

  await emitBroadcast(page, {
    ...rollingState(),
    version: 2,
    phase: "moving",
    turn: "white",
    dice: [3, 5],
    remaining: [3, 5],
  });

  await expect(component.getByTestId("version")).toHaveText("2");
  await expect(component.getByTestId("phase")).toHaveText("moving");
  await expect(component.getByTestId("dice")).toHaveText("[3,5]");
});

test("move sends a move intent with from and to", async ({ mount, page }) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), version: 1 });

  await component.getByTestId("move").click();

  await expect
    .poll(
      async () =>
        (await sentMessages(page)).some((m) => m.payload?.action === "move"),
      { timeout: 3000 },
    )
    .toBe(true);
  const moveMsg = (await sentMessages(page)).find(
    (m) => m.payload?.action === "move",
  )!;
  expect(moveMsg.payload).not.toHaveProperty("state");
  expect(moveMsg.payload).toEqual({ action: "move", from: 23, to: 19 });
});

test("undo sends an undo intent", async ({ mount, page }) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), version: 1 });

  await component.getByTestId("undo").click();

  await expect
    .poll(
      async () =>
        (await sentMessages(page)).some((m) => m.payload?.action === "undo"),
      { timeout: 3000 },
    )
    .toBe(true);
  const undoMsg = (await sentMessages(page)).find(
    (m) => m.payload?.action === "undo",
  )!;
  expect(undoMsg.payload).not.toHaveProperty("state");
  expect(undoMsg.payload).toEqual({ action: "undo" });
});

test("confirming give up sends a give_up message", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameScreen />
    </GameProvider>,
  );
  await emitInitialState(page, { ...midGameState(), version: 1 });

  await component.getByRole("button", { name: "Give up" }).click();
  await component.getByRole("button", { name: "Yes", exact: true }).click();

  await expect
    .poll(
      async () => (await sentMessages(page)).some((m) => m.type === "give_up"),
      { timeout: 3000 },
    )
    .toBe(true);
});

test("server auto-pass after a roll shows the no-moves overlay", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...rollingState(), version: 1 });

  // Server rolled (2, 4), found no legal moves, auto-passed to black.
  await emitBroadcast(page, {
    ...rollingState(),
    version: 2,
    phase: "rolling",
    turn: "black",
    dice: [2, 4],
    remaining: [],
    message: "No legal moves",
  });

  await expect(component.getByTestId("no-moves")).toHaveText("true");
  await expect(component.getByTestId("phase")).toHaveText("rolling");
});

test("opening result broadcast populates the opening result", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...rollingState(), version: 1 });

  await emitBroadcast(page, {
    ...rollingState(),
    version: 2,
    phase: "opening_result",
    turn: "white",
    openingRoll: { white: 5, black: 3 },
  });

  await expect(component.getByTestId("opening-result")).toHaveText(
    '{"myDie":5,"opponentDie":3,"winner":"white"}',
  );
});

function gameOverState(): GameState {
  return { ...newGame(), phase: "game_over", winner: "white", version: 2 };
}

test("an intermediate game end shows its result until the next game starts", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), version: 1 });

  await emitGameEnded(page, {
    winner: "white",
    winType: "single",
    points: 1,
    cube: 1,
    whiteScore: 1,
    blackScore: 0,
    targetPoints: 7,
  });

  await expect(component.getByTestId("game-result")).toHaveText(
    '{"winner":"white"}',
  );

  // Server auto-starts the next game and broadcasts a fresh opening roll.
  await emitBroadcast(page, { ...gameOverState(), version: 3, phase: "opening_roll" });

  await expect(component.getByTestId("game-result")).toHaveText("null");
  await expect(component.getByTestId("phase")).toHaveText("opening_roll");
});

test("handleNextGame sends a next_game intent after an intermediate game", async ({ mount, page }) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), version: 1 });

  await emitGameEnded(page, {
    winner: "white",
    winType: "single",
    points: 1,
    cube: 1,
    whiteScore: 1,
    blackScore: 0,
    targetPoints: 7,
  });
  await expect(component.getByTestId("game-result")).toHaveText(
    '{"winner":"white"}',
  );

  await component.getByTestId("next").click();

  await expect
    .poll(
      async () =>
        (await sentMessages(page)).some(
          (m) => m.payload?.action === "next_game",
        ),
      { timeout: 3000 },
    )
    .toBe(true);
});
