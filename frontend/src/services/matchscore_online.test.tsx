import { test, expect } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { GameProvider } from "./gameContext";
import { MatchScoreProbe } from "../test-utils/probes";
import { newGame } from "../lib/backgammon/engine";
import type { GameState } from "../lib/backgammon/engine";

interface FakeSocket { sent: string[]; emit: (message: unknown) => void; }

async function seedFakeSocket(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem("bg_access_token", "test-token");
    const w = window as unknown as Record<string, unknown>;
    class FakeWebSocket {
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      sent: string[] = [];
      constructor(_url: string) {
        w.__fakeWs = this;
        setTimeout(() => this.onopen?.(), 0);
      }
      send(data: string) { this.sent.push(data); }
      close() { this.readyState = 3; this.onclose?.(); }
      emit(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
    }
    Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    w.WebSocket = FakeWebSocket;
  });
}

function freshState(): GameState {
  return { ...newGame(), version: 1 };
}

async function emitSocket(page: Page, message: unknown) {
  await page.evaluate((payload) => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    ws.emit(payload);
  }, message);
}

test("online matchScore survives game_ended then fresh opening_roll", async ({ mount, page }) => {
  await seedFakeSocket(page);
  await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <MatchScoreProbe />
    </GameProvider>,
  );

  await page.waitForFunction(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    return !!ws;
  });
  await expect(page.getByTestId("score")).toHaveText('{"white":0,"black":0}');

  await emitSocket(page, {
    type: "state_update",
    payload: freshState(),
    playerColor: "white",
    initial: true,
  });
  await expect(page.getByTestId("score")).toHaveText('{"white":0,"black":0}');

  await emitSocket(page, {
    type: "game_ended",
    payload: { winner: "white", winType: "single", points: 1, cube: 1, whiteScore: 1, blackScore: 0, targetPoints: 7 },
  });
  await expect(page.getByTestId("score")).toHaveText('{"white":1,"black":0}');
  await expect(page.getByTestId("game-result")).toHaveText('{"winner":"white"}');

  // Fresh opening_roll = next game auto-started by server after 30s countdown
  await emitSocket(page, {
    type: "state_update",
    payload: { ...freshState(), version: 2 },
    playerColor: "white",
    initial: false,
  });
  await expect(page.getByTestId("score")).toHaveText('{"white":1,"black":0}');
});

test("online final result appears when the match is over", async ({ mount, page }) => {
  await seedFakeSocket(page);
  await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <MatchScoreProbe />
    </GameProvider>,
  );

  await page.waitForFunction(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    return !!ws;
  });

  await emitSocket(page, {
    type: "state_update",
    payload: freshState(),
    playerColor: "white",
    initial: true,
  });

  await emitSocket(page, {
    type: "game_ended",
    payload: { winner: "white", winType: "single", points: 1, cube: 1, whiteScore: 7, blackScore: 4, targetPoints: 7 },
  });

  await expect(page.getByTestId("score")).toHaveText('{"white":7,"black":4}');
  await expect(page.getByTestId("game-result")).toHaveText('{"winner":"white"}');
});

test("online matchScore hydrates from the initial reconnect snapshot", async ({ mount, page }) => {
  await seedFakeSocket(page);
  await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <MatchScoreProbe />
    </GameProvider>,
  );

  await page.waitForFunction(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    return !!ws;
  });
  await expect(page.getByTestId("score")).toHaveText('{"white":0,"black":0}');

  await emitSocket(page, {
    type: "state_update",
    payload: freshState(),
    playerColor: "white",
    initial: true,
    matchScore: { white: 2, black: 1 },
  });

  await expect(page.getByTestId("score")).toHaveText('{"white":2,"black":1}');
});
