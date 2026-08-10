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

test("online matchScore survives game_ended then fresh opening_roll", async ({ mount, page }) => {
  await seedFakeSocket(page);
  const component = await mount(
    <GameProvider roomId="test-room" playerColor="white">
      <MatchScoreProbe />
    </GameProvider>,
  );

  await page.waitForFunction(() => {
    const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;
    return !!ws;
  });
  const ws = (window as unknown as Record<string, FakeSocket>).__fakeWs;

  ws.emit({ type: "state_update", payload: freshState(), playerColor: "white", initial: true });
  await expect(component.getByTestId("score")).toHaveText('{"white":0,"black":0}');

  ws.emit({
    type: "game_ended",
    payload: { winner: "white", winType: "single", points: 1, cube: 1, whiteScore: 1, blackScore: 0, targetPoints: 7 },
  });
  await expect(component.getByTestId("score")).toHaveText('{"white":1,"black":0}');

  // Fresh opening_roll = next game auto-started by server after 30s countdown
  ws.emit({ type: "state_update", payload: { ...freshState(), version: 2 }, playerColor: "white", initial: false });
  await expect(component.getByTestId("score")).toHaveText('{"white":1,"black":0}');
});
