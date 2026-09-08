import { test, expect } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { GameProvider } from "../../services/gameContext";
import { newGame, type GameState } from "../../lib/backgammon/engine";
import { GameProbe } from "../../test-utils/probes";
import GameScreen from "./GameScreen";

interface FakeSocket {
  emit: (message: unknown) => void;
}

interface FrameAudit {
  gaps: number[];
  longTasks: number[];
  stop: () => void;
}

const profiles = [
  {
    name: "Android Go landscape",
    viewport: { width: 640, height: 360 },
    cpuSlowdown: 6,
    latencyMs: 650,
    jitterMs: 250,
  },
  {
    name: "wide budget Android landscape",
    viewport: { width: 740, height: 360 },
    cpuSlowdown: 6,
    latencyMs: 800,
    jitterMs: 300,
  },
  {
    name: "older phone landscape",
    viewport: { width: 667, height: 375 },
    cpuSlowdown: 4,
    latencyMs: 400,
    jitterMs: 180,
  },
];

function onlineMoveState(): GameState {
  return {
    ...newGame(),
    phase: "moving",
    turn: "white",
    dice: [4, 3],
    remaining: [4, 3],
    lastMove: [],
    moveHistory: [],
    message: "White — make a move",
    version: 1,
  };
}

async function seedFakeSocket(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("bg_access_token", "low-end-test-token");
    const browserWindow = window as unknown as Record<string, unknown>;
    class FakeWebSocket {
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(_url: string) {
        browserWindow.__lowEndFakeWs = this;
        setTimeout(() => this.onopen?.(), 0);
      }
      send() {}
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
    browserWindow.WebSocket = FakeWebSocket;
  });
}

async function emitState(page: Page, state: GameState, delayMs = 0) {
  await page.evaluate(
    ({ nextState, delay }) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          const socket = (
            window as unknown as Record<string, FakeSocket>
          ).__lowEndFakeWs;
          socket.emit({
            type: "state_update",
            payload: nextState,
            playerColor: "white",
            players: { white: "whiteUser", black: "blackUser" },
            timeControl: "none",
            initial: nextState.version === 1,
          });
          resolve();
        }, delay);
      }),
    { nextState: state, delay: delayMs },
  );
}

for (const profile of profiles) {
  test(`online play remains responsive on ${profile.name}`, async ({
    mount,
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== "chromium",
      "Low-end CPU emulation requires Chromium performance instrumentation.",
    );
    await page.setViewportSize(profile.viewport);
    await seedFakeSocket(page);

    const component = await mount(
      <GameProvider roomId="low-end-room" playerColor="white">
        <GameScreen />
        <GameProbe from={23} to={19} />
      </GameProvider>,
    );
    await expect(component.getByTestId("loading")).toHaveText("false");
    const initial = onlineMoveState();
    await emitState(page, initial);
    await expect(component.getByTestId("board-frame")).toBeVisible();

    const session = await page.context().newCDPSession(page);
    await session.send("Emulation.setCPUThrottlingRate", {
      rate: profile.cpuSlowdown,
    });
    await page.waitForTimeout(750);
    await page.evaluate(() => {
      let previous: number | null = null;
      let frame = 0;
      const audit: FrameAudit = { gaps: [], longTasks: [], stop: () => {} };
      const observer = new PerformanceObserver((list) => {
        audit.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      });
      observer.observe({ type: "longtask" });
      const tick = (now: number) => {
        if (previous !== null) audit.gaps.push(now - previous);
        previous = now;
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      audit.stop = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
      };
      (window as unknown as { __lowEndFrameAudit: FrameAudit }).__lowEndFrameAudit = audit;
    });

    const interactionStarted = Date.now();
    await component.locator('[data-point-idx="23"]').click();
    await component.locator('[data-point-idx="19"]').click();
    await expect(component.getByTestId("point-19")).toHaveText("1");
    const optimisticResponseMs = Date.now() - interactionStarted;

    const acknowledged = {
      ...initial,
      points: [...initial.points],
      remaining: [3],
      lastMove: [{ from: 23, to: 19 }],
      version: 2,
    };
    acknowledged.points[23] -= 1;
    acknowledged.points[19] += 1;
    await emitState(page, acknowledged, profile.latencyMs + profile.jitterMs);

    for (let update = 0; update < 8; update++) {
      const remoteState: GameState = {
        ...acknowledged,
        turn: "black",
        dice: [update % 6 + 1, (update + 2) % 6 + 1],
        remaining: [update % 6 + 1],
        message: `Delayed online update ${update + 1}`,
        version: update + 3,
      };
      const startsSecondBurst = update === 4;
      await emitState(
        page,
        remoteState,
        startsSecondBurst ? profile.latencyMs + profile.jitterMs : 35,
      );
    }
    await expect(component.getByTestId("version")).toHaveText("10");
    await page.waitForTimeout(500);

    const metrics = await page.evaluate(() => {
      const audit = (
        window as unknown as { __lowEndFrameAudit: FrameAudit }
      ).__lowEndFrameAudit;
      audit.stop();
      const sorted = [...audit.gaps].sort((a, b) => a - b);
      return {
        frames: sorted.length,
        frameGapP95ms: Number(
          (sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2),
        ),
        maxFrameGapMs: Number(Math.max(0, ...sorted).toFixed(2)),
        mainThreadTasksOver50ms: audit.longTasks.length,
        longestMainThreadTaskMs: Number(
          Math.max(0, ...audit.longTasks).toFixed(2),
        ),
      };
    });
    const result = { profile, optimisticResponseMs, ...metrics };
    console.log(JSON.stringify(result));
    await testInfo.attach("low-end-online-metrics", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });

    expect(optimisticResponseMs).toBeLessThan(500);
    expect(metrics.frames).toBeGreaterThan(30);
    expect(metrics.frameGapP95ms).toBeLessThan(80);
    expect(metrics.maxFrameGapMs).toBeLessThan(180);
  });
}
