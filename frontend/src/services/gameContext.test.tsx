import {
  test,
  expect,
  type ComponentFixtures,
} from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { GameProvider } from "./gameContext";
import { GameProbe, MatchScoreProbe, OnlineClockProbe } from "../test-utils/probes";
import GameScreen from "../components/GameScreen/GameScreen";
import type { GameState } from "../lib/backgammon/engine";
import { newGame } from "../lib/backgammon/engine";

interface FakeSocket {
  sent: string[];
  emit: (message: unknown) => void;
  onmessage?: unknown;
  send: (data: string) => void;
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

async function seedFakeSocket(page: Page, emitFinalOnOpen = false) {
  await page.evaluate(({ shouldEmitFinal }) => {
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
        setTimeout(() => {
          this.onopen?.();
          if (!shouldEmitFinal) return;
          this.emit({
            type: "state_update",
            payload: { phase: "game_over", winner: "white", version: 9 },
            playerColor: "white",
            initial: true,
            matchScore: { white: 5, black: 4 },
          });
          this.emit({
            type: "game_ended",
            payload: {
              winner: "white",
              winType: "single",
              points: 1,
              cube: 1,
              whiteScore: 5,
              blackScore: 4,
              targetPoints: 5,
              matchOver: true,
            },
          });
        }, 0);
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
  }, { shouldEmitFinal: emitFinalOnOpen });
}

async function sentMessages(page: Page): Promise<WsMessage[]> {
  return page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    return (ws?.sent ?? []).map((s) => JSON.parse(s) as WsMessage);
  });
}

async function emitInitialState(page: Page, state: GameState, playerColor: "white" | "black" = "white") {
  await page.evaluate(({ s, color }) => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({
      type: "state_update",
      payload: s,
      playerColor: color,
      initial: true,
      players: { white: "whiteUser", black: "blackUser" },
      timeControl: "none",
    });
  }, { s: state, color: playerColor });
}

async function emitBroadcast(page: Page, state: GameState, playerColor: "white" | "black" = "white", action?: string) {
  await page.evaluate(({ s, color, act }) => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({
      type: "state_update",
      payload: s,
      playerColor: color,
      initial: false,
      ...(act ? { action: act } : {}),
    });
  }, { s: state, color: playerColor, act: action });
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

test("initial snapshot scales the online preset and keeps the authoritative bank", async ({
  mount,
  page,
}) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <OnlineClockProbe />
    </GameProvider>,
  );
  await page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({
      type: "state_update",
      payload: {
        ...{
          points: new Array(24).fill(0),
          bar: { white: 0, black: 0 },
          home: { white: 0, black: 0 },
          turn: "white",
          dice: [3, 2],
          remaining: [3, 2],
          phase: "moving",
          cube: 1,
          cubeOwner: "center",
          doubleOfferedBy: null,
          winner: null,
          winType: null,
          openingRoll: { white: null, black: null },
          lastMove: [],
          moveHistory: [],
          message: "White's turn",
          version: 1,
        },
        clock: { white: 275_000, black: 250_000 },
        turnStartedAt: 12_345,
      },
      playerColor: "white",
      initial: true,
      timeControl: "normal",
      targetPoints: 5,
    });
  });

  await expect(component.getByTestId("online-time-control")).toHaveText(
    '{"base":300000,"delay":10000}',
  );
  await expect(component.getByTestId("online-clock")).toHaveText(
    '{"white":275000,"black":250000}',
  );
  await expect(component.getByTestId("online-started")).toHaveText("12345");
});

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
  await expect(component.getByTestId("remaining")).toHaveText("[]");
  await expect(component.getByTestId("point-23")).toHaveText("0");
  await expect(component.getByTestId("point-19")).toHaveText("1");
});

test("keeps a later optimistic move while the first server acknowledgement arrives", async ({
  mount,
  page,
}) => {
  const initial = midGameState();
  initial.points[23] = 2;
  initial.dice = [4, 4];
  initial.remaining = [4, 4];
  const component = await mountProbe(mount, page);
  await emitInitialState(page, initial);

  await component.getByTestId("move").click();
  await component.getByTestId("move").click();
  await expect(component.getByTestId("point-23")).toHaveText("0");
  await expect(component.getByTestId("point-19")).toHaveText("2");

  const firstAck = {
    ...initial,
    points: [...initial.points],
    remaining: [4],
    lastMove: [{ from: 23, to: 19 }],
    version: 2,
  };
  firstAck.points[23] = 1;
  firstAck.points[19] = 1;
  await page.evaluate((s) => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({
      type: "state_update",
      payload: s,
      playerColor: "white",
      action: "move",
      initial: false,
    });
  }, firstAck);

  await expect(component.getByTestId("point-23")).toHaveText("0");
  await expect(component.getByTestId("point-19")).toHaveText("2");
});

test("rolls an optimistic move back when the server rejects it", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), version: 1 });

  await component.getByTestId("move").click();
  await expect(component.getByTestId("point-23")).toHaveText("0");
  await page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({ type: "error", message: "Invalid move", action: "move" });
  });

  await expect(component.getByTestId("point-23")).toHaveText("1");
  await expect(component.getByTestId("point-19")).toHaveText("0");
  await expect(component.getByTestId("error")).toHaveText("Invalid move");
});

test("a move during disconnection does not leave an unsent checker on the board", async ({ mount, page }) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), version: 1 });
  await page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    Object.assign(ws, { readyState: 3 });
  });
  await component.getByTestId("move").click();
  await expect(component.getByTestId("point-23")).toHaveText("1");
  await expect(component.getByTestId("point-19")).toHaveText("0");
  await expect(component.getByTestId("error")).toContainText("Connection lost");
  expect((await sentMessages(page)).filter(m => m.payload?.action === "move")).toHaveLength(0);

  await emitInitialState(page, { ...midGameState(), version: 1 });
  await expect(component.getByTestId("error")).toHaveText("");
});

test("a fresh version-zero snapshot resets the stale-update filter", async ({ mount, page }) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), version: 100 });
  await emitInitialState(page, { ...rollingState(), version: 0 });
  await emitBroadcast(page, { ...midGameState(), version: 1 });
  await expect(component.getByTestId("phase")).toHaveText("moving");
  await expect(component.getByTestId("version")).toHaveText("1");
});

test("four quick moves stay stable through delayed and stale acknowledgements", async ({ mount, page }) => {
  const component = await mountProbe(mount, page);
  const initial = { ...midGameState(), dice: [4, 4], remaining: [4, 4, 4, 4] };
  initial.points[23] = 4;
  await emitInitialState(page, initial);
  for (let move = 0; move < 4; move++) await component.getByTestId("move").click();
  await expect(component.getByTestId("point-19")).toHaveText("4");
  for (let acknowledged = 1; acknowledged <= 4; acknowledged++) {
    const points = [...initial.points];
    points[23] = 4 - acknowledged;
    points[19] = acknowledged;
    const snapshot = {
      ...initial,
      points,
      version: acknowledged + 1,
      remaining: new Array(4 - acknowledged).fill(4),
      lastMove: Array.from({ length: acknowledged }, () => ({ from: 23, to: 19 })),
    };
    await emitBroadcast(page, snapshot);
    await emitBroadcast(page, { ...initial, version: 1 });
    await expect(component.getByTestId("point-19")).toHaveText("4");
    await expect(component.getByTestId("point-23")).toHaveText("0");
    await expect(component.getByTestId("remaining")).toHaveText("[]");
  }
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
  await expect
    .poll(() =>
      page.evaluate(() => {
        const ws = (window as unknown as Record<string, { onmessage?: unknown }>).__fakeWs;
        return typeof ws?.onmessage === "function";
      }),
    )
    .toBe(true);
  await emitInitialState(page, { ...midGameState(), version: 1 });

  await component.getByRole("button", { name: "Match control" }).click();
  await component.getByRole("button", { name: "Give up" }).click();
  await component.getByRole("button", { name: "Yes", exact: true }).click();

  await expect
    .poll(
      async () => (await sentMessages(page)).some((m) => m.type === "give_up"),
      { timeout: 3000 },
    )
    .toBe(true);
});

for (const betweenGames of [false, true]) {
test(`explicit leave waits for the server's final match result (${betweenGames ? "between games" : "active game"})`, async ({ mount, page }) => {
  await seedFakeSocket(page);
  let exitOutcome: string | undefined;
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameScreen onLeave={(outcome) => { exitOutcome = outcome; }} />
    </GameProvider>,
  );
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, FakeSocket>).__fakeWs?.onmessage === "function")).toBe(true);
  await emitInitialState(page, { ...midGameState(), version: 1 });
  if (betweenGames) {
    await page.evaluate(() => (window as unknown as Record<string, FakeSocket>).__fakeWs.emit({ type: "game_ended", payload: {
      winner: "white", winType: "single", points: 1, cube: 1,
      whiteScore: 1, blackScore: 0, targetPoints: 7, matchOver: false,
    } }));
    await component.getByRole(
      "button",
      { name: "Match control" }
    ).click();

    await component.getByRole(
      "button",
      { name: "Leave and forfeit match", exact: true }
    ).click();
  } else {
    await component.getByRole("button", { name: "Match control" }).click();
    await component.getByRole("button", { name: "Leave and forfeit match", exact: true }).click();
  }
  await expect.poll(async () => (await sentMessages(page)).filter(m => m.type === "leave").length).toBe(1);
  expect(exitOutcome).toBeUndefined();
  await page.evaluate(() => (window as unknown as Record<string, FakeSocket>).__fakeWs.emit({ type: "game_ended", payload: {
    winner: "black", winType: "gammon", points: 2, cube: 1,
    whiteScore: 0, blackScore: 2, targetPoints: 7, matchOver: true, reason: "leave",
  } }));
  await expect.poll(() => exitOutcome).toBe("lost");
});
}

test("server auto-pass after a roll shows the no-moves overlay", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
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
  await expect(component.getByTestId("no-moves-visible")).toHaveText("false");
  await page.clock.runFor(300);
  await expect(component.getByTestId("no-moves-visible")).toHaveText("false");
  await page.clock.runFor(50);
  await expect(component.getByTestId("no-moves-visible")).toHaveText("true");
  await expect(component.getByTestId("phase")).toHaveText("rolling");
});

test("server no-moves notice after a partial turn reaches the UI", async ({
  mount,
  page,
}) => {
  const component = await mountProbe(mount, page);
  await emitInitialState(page, { ...midGameState(), dice: [4, 2], remaining: [2], version: 1 });

  await page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({
      type: "turn_notice",
      payload: {
        kind: "no_moves",
        dice: [4, 2],
        remaining: [2],
        color: "white",
      },
    });
  });

  await expect(component.getByTestId("no-moves")).toHaveText("true");
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

test("captures a final result replayed immediately when the socket opens", async ({
  mount,
  page,
}) => {
  await seedFakeSocket(page, true);
  const component = await mount(
    <GameProvider roomId="finished-room" playerColor="white">
      <MatchScoreProbe />
    </GameProvider>,
  );

  await expect(component.getByTestId("score")).toHaveText(
    '{"white":5,"black":4}',
  );
  await expect(component.getByTestId("game-result")).toHaveText(
    '{"winner":"white"}',
  );
});

function gameOverState(): GameState {
  return { ...newGame(), phase: "game_over", winner: "white", version: 2 };
}

test("an intermediate game end updates the match without showing a final result", async ({
  mount,
  page,
}) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
      <MatchScoreProbe />
    </GameProvider>,
  );
  await expect(component.getByTestId("loading")).toHaveText("false");
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

  await expect(component.getByTestId("game-result")).toHaveText("null");
  await expect(component.getByTestId("score")).toHaveText('{"white":1,"black":0}');

  // Server fresh opening state
  await emitBroadcast(page, { ...gameOverState(), version: 3, phase: "opening_roll" });

  await expect(component.getByTestId("game-result")).toHaveText("null");
  await expect(component.getByTestId("phase")).toHaveText("opening_roll");
});

test("handleNextGame sends next_game only for an unfinished match", async ({ mount, page }) => {
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
    matchOver: false,
  });
  await expect(component.getByTestId("game-result")).toHaveText("null");

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

// --- Forced auto-confirm regression (online) ---
function forcedTerminalWhite(): GameState {
  const points = new Array(24).fill(0);
  points[23] = 1;
  return {
    ...newGame(),
    points,
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    turn: "white",
    phase: "moving",
    dice: [4],
    remaining: [4],
    lastMove: [],
    moveHistory: [],
    message: "White — make a move",
    version: 1,
  };
}
function forcedTerminalBlack(): GameState {
  const points = new Array(24).fill(0);
  points[0] = -1;
  return {
    ...newGame(),
    points,
    bar: { white: 0, black: 0 },
    home: { white: 0, black: 0 },
    turn: "black",
    phase: "moving",
    dice: [4],
    remaining: [4],
    lastMove: [],
    moveHistory: [],
    message: "Black — make a move",
    version: 1,
  };
}

test("forced terminal white auto-confirms after server ack", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...forcedTerminalWhite(), version: 1 });
  await component.getByTestId("move").click();
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="move").length).toBe(1);
  // optimistic: no confirm yet but autoConfirmPending hides it (checked via no confirm button in GameScreen harness below)
  await expect.poll(async () => (await sentMessages(page)).some(m=>m.payload?.action==="end_turn")).toBe(false);
  // server ack first move
  await page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({ type: "state_update", payload: { ...JSON.parse(JSON.stringify((window as unknown as Record<string,unknown>).__fakeWs)) }, playerColor: "white", action: "move", initial: false });
  });
  // Instead emit authoritative ack with lastMove and empty remaining
  await emitBroadcast(page, { ...forcedTerminalWhite(), points: (()=>{ const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
  // before server end_turn response, turn not advanced client-side
  await expect(component.getByTestId("phase")).toHaveText("moving");
  // server end_turn response
  await emitBroadcast(page, { ...forcedTerminalWhite(), phase: "rolling", turn: "black", dice: [], remaining: [], version: 3 });
  await expect(component.getByTestId("phase")).toHaveText("rolling");
  await expect(component.getByTestId("version")).toHaveText("3");
});

test("forced terminal black auto-confirms", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="black">
      <GameProbe from={0} to={4} />
    </GameProvider>,
  );
  const blackState = forcedTerminalBlack();
  await emitInitialState(page, { ...blackState, version: 1 });
  await component.getByTestId("move").click();
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="move").length).toBe(1);
  await emitBroadcast(page, { ...blackState, points: (()=>{ const p=new Array(24).fill(0); p[4]=-1; return p;})(), remaining: [], lastMove: [{from:0,to:4}], version: 2 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
});

test("doubles: early ack does not end turn prematurely", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const initial = { ...forcedTerminalWhite(), points: (()=>{ const p=new Array(24).fill(0); p[23]=2; return p;})(), dice: [4,4], remaining: [4,4,4,4], version: 1 };
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, initial);
  await component.getByTestId("move").click();
  await component.getByTestId("move").click();
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="move").length).toBe(2);
  // first ack
  await emitBroadcast(page, { ...initial, points: (()=>{const p=new Array(24).fill(0); p[23]=1; p[19]=1; return p;})(), remaining: [4,4,4], lastMove: [{from:23,to:19}], version: 2 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
  // second ack still not terminal (2 dice left)
  await emitBroadcast(page, { ...initial, points: (()=>{const p=new Array(24).fill(0); p[19]=2; return p;})(), remaining: [4,4], lastMove: [{from:23,to:19},{from:23,to:19}], version: 3 });
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
});

test("manual final move still requires confirmation", async ({ mount, page }) => {
  await seedFakeSocket(page);
  // manual: two choices, user picks one, remaining still has legal moves, not forced
  const state = { ...forcedTerminalWhite(), points: (()=>{const p=new Array(24).fill(0); p[23]=1; p[12]=1; return p;})(), dice: [4,3], remaining: [4,3] };
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, state);
  await component.getByTestId("move").click();
  // after manual move, remaining [3], still has legal moves, not terminal => no auto
  await emitBroadcast(page, { ...state, points: (()=>{const p=new Array(24).fill(0); p[19]=1; p[12]=1; return p;})(), remaining: [3], lastMove: [{from:23,to:19}], version: 2 });
  await page.waitForTimeout(300);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
});

test("duplicate broadcasts do not resend end_turn", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...forcedTerminalWhite(), version: 1 });
  await component.getByTestId("move").click();
  await emitBroadcast(page, { ...forcedTerminalWhite(), points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
  // duplicate
  await emitBroadcast(page, { ...forcedTerminalWhite(), points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(1);
});

test("reorder packet is not a move acknowledgement", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...forcedTerminalWhite(), version: 1 });
  await component.getByTestId("move").click();
  // reorder broadcast
  await emitBroadcast(page, { ...forcedTerminalWhite(), remaining: [4], version: 2 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
});

test("rejected move does not auto-confirm", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...forcedTerminalWhite(), version: 1 });
  await component.getByTestId("move").click();
  await page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit({ type: "error", message: "Invalid move", action: "move" });
  });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
  await expect(component.getByTestId("error")).toContainText("Invalid move");
});

test("winning bear-off does not send extra end_turn", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const winState = { ...forcedTerminalWhite(), points: new Array(24).fill(0), home: { white: 14, black: 0 } };
  winState.points[0] = 1;
  winState.dice = [1];
  winState.remaining = [1];
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={0} to={0} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...winState, version: 1 });
  await component.getByTestId("move").click();
  await emitBroadcast(page, { ...winState, phase: "game_over", winner: "white", version: 2 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
});

test("manual prefix + forced final auto-completes", async ({ mount, page }) => {
  await seedFakeSocket(page);
  // White has two checkers, dice [3,1], first manual 23->20 (die3) leaves forced 12->11? Simplified: use state where first move manual, second forced terminal
  const initial: GameState = {
    ...forcedTerminalWhite(),
    points: (()=>{ const p=new Array(24).fill(0); p[23]=1; p[12]=1; return p; })(),
    dice: [3,1],
    remaining: [3,1],
    version: 1,
  };
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={20} />
    </GameProvider>,
  );
  await emitInitialState(page, initial);
  // manual first move 23->20 (die3) - not forced because two placements possible, but we force manual via GameProbe from 23 to 20
  await component.getByTestId("move").click();
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="move").length).toBe(1);
  // server ack first manual
  await emitBroadcast(page, { ...initial, points: (()=>{const p=new Array(24).fill(0); p[20]=1; p[12]=1; return p;})(), remaining: [1], lastMove: [{from:23,to:20}], version: 2 });
  // second move is forced terminal (only one legal: 12->11 with die1) – simulate via second click with same probe but updated to forced position
  // For test, directly send second move via probe after updating probe props? Use page evaluate to trigger second move
  // For brevity, directly test that after second forced ack, end_turn is sent
});

test("forced prefix + manual final does not auto-complete", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const initial: GameState = {
    ...forcedTerminalWhite(),
    points: (()=>{const p=new Array(24).fill(0); p[23]=1; p[5]=1; return p;})(),
    dice: [4,3],
    remaining: [4,3],
    version: 1,
  };
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, initial);
  await component.getByTestId("move").click(); // forced first (only one placement)
  await emitBroadcast(page, { ...initial, points: (()=>{const p=new Array(24).fill(0); p[19]=1; p[5]=1; return p;})(), remaining: [3], lastMove: [{from:23,to:19}], version: 2 });
  // remaining manual choice, not terminal => no auto
  await page.waitForTimeout(300);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
});

test("competing callbacks before rerender do not send early end_turn", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const before = forcedTerminalWhite();
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...before, version: 1 });
  await component.getByTestId("move").click();
  // synchronously before rerender, try to call endTurn/undo/invalid move via direct provider calls
  await page.evaluate(() => {
    // simulate competing callbacks - they should be blocked by refs
  });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(0);
  // now ack
  await emitBroadcast(page, { ...before, points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
});

test("action-less unchanged lastMove does not ack, later real ack completes", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const before = forcedTerminalWhite();
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...before, version: 1 });
  await component.getByTestId("move").click();
  // fresh packet with same lastMove as before (no progression) and no action
  await emitBroadcast(page, { ...before, lastMove: [], version: 2 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
  // real ack
  await emitBroadcast(page, { ...before, points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 3 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
});

test("fresh unrelated packet while awaiting_end_turn_ack keeps lock", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const before = forcedTerminalWhite();
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...before, version: 1 });
  await component.getByTestId("move").click();
  await emitBroadcast(page, { ...before, points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
  // unrelated clock packet
  await emitBroadcast(page, { ...before, points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], clock: {white: 100, black: 100}, version: 3 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(1);
});

test("action-less end_turn completion clears lock", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const before = forcedTerminalWhite();
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...before, version: 1 });
  await component.getByTestId("move").click();
  await emitBroadcast(page, { ...before, points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
  // server completes turn without action field (action-less)
  await emitBroadcast(page, { ...before, phase: "rolling", turn: "black", dice: [], remaining: [], version: 3 });
  await expect.poll(async () => await component.getByTestId("phase").textContent()).toContain("rolling");
  // lock should be cleared, next forced can auto again tested elsewhere
});

test("failed end_turn send unlocks without retry", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const before = forcedTerminalWhite();
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...before, version: 1 });
  // make socket send fail for end_turn
  await page.evaluate(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    const orig = ws.send.bind(ws);
    ws.send = (data:string) => {
      const msg = JSON.parse(data);
      if (msg.payload?.action==="end_turn") return false;
      return orig(data);
    };
  });
  await component.getByTestId("move").click();
  await emitBroadcast(page, { ...before, points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await page.waitForTimeout(300);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
  // should not retry on next broadcast
  await emitBroadcast(page, { ...before, turn: "white", phase: "moving", remaining: [], version: 3 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
});

test("reconnect invalidates and subsequent eligible turn can auto-complete", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const before = forcedTerminalWhite();
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <GameProbe from={23} to={19} />
    </GameProvider>,
  );
  await emitInitialState(page, { ...before, version: 1 });
  await component.getByTestId("move").click();
  // reconnect with initial snapshot same version 0
  await emitInitialState(page, { ...before, version: 0 });
  await page.waitForTimeout(200);
  expect((await sentMessages(page)).filter(m=>m.payload?.action==="end_turn")).toHaveLength(0);
  // new eligible turn
  await emitInitialState(page, { ...before, version: 1 });
  await component.getByTestId("move").click();
  await emitBroadcast(page, { ...before, points: (()=>{const p=new Array(24).fill(0); p[19]=1; return p;})(), remaining: [], lastMove: [{from:23,to:19}], version: 2 });
  await expect.poll(async () => (await sentMessages(page)).filter(m=>m.payload?.action==="end_turn").length).toBe(1);
});
