import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { test, expect } from "@playwright/experimental-ct-react";
import type { Page } from "@playwright/test";
import { newGame } from "../../lib/backgammon/engine";
import SpectatorScreen from "./SpectatorScreen";
import { readSpectatorSnapshot } from "../../types/spectator";

const roomId = "519fa74f-dd66-4f04-84b3-89b788b4a6f4";
const secondRoom = "95c621a3-54f4-4071-9cf7-bf54e51b34b4";
const meta = { whiteName: "White player", blackName: "Black player", targetPoints: 7, matchScore: { white: 2, black: 3 }, timeControl: "normal" };
const state = { ...newGame(), phase: "moving", turn: "white", dice: [3, 2], remaining: [3, 2], version: 9, clock: { white: 300000, black: 300000 }, turnStartedAt: Date.now() };

interface FakeSocket {
  readyState: number;
  url: string;
  sent: string[];
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
}

test.beforeEach(async ({ page }) => {
  await page.evaluate(({ roomId, secondRoom }) => {
    window.sessionStorage.setItem(`6b-spectator-v1:${roomId}`, "initial-ticket");
    window.sessionStorage.setItem(`6b-spectator-v1:${secondRoom}`, "second-ticket");
    document.documentElement.lang = "en";
    const sockets: FakeSocket[] = [];
    (window as unknown as { watchSockets: FakeSocket[] }).watchSockets = sockets;
    class WatchSocket {
      static OPEN = 1;
      readyState = 0;
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public url: string) {
        sockets.push(this);
        queueMicrotask(() => {
          if (this.readyState === 3) return;
          this.readyState = 1;
          this.onopen?.();
        });
      }
      send(data: string) { this.sent.push(data); }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.();
      }
    }
    window.WebSocket = WatchSocket as unknown as typeof WebSocket;
  }, { roomId, secondRoom });
});

function screen(id = roomId) {
  return <StrictMode><MemoryRouter initialEntries={[`/watch/${id}`]}><Routes>
    <Route path="/watch/:roomId" element={<SpectatorScreen returnUrl="/6b/tournaments/tournaments/1/bracket" />} />
  </Routes></MemoryRouter></StrictMode>;
}

async function emit(page: Page, message: unknown, index?: number) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { watchSockets: FakeSocket[] }).watchSockets.some(socket => socket.readyState === 1))).toBe(true);
  await page.evaluate(({ message, index }) => {
    const sockets = (window as unknown as { watchSockets: FakeSocket[] }).watchSockets;
    const socket = index == null ? sockets.filter(socket => socket.readyState === 1).slice(-1)[0] : sockets[index];
    socket.onmessage?.({ data: JSON.stringify(message) });
  }, { message, index });
}

test("watching renders both players without player actions or account requests", async ({ mount, page }) => {
  const playerRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("player-details")) playerRequests.push(request.url()); });
  const component = await mount(screen());
  await emit(page, { type: "spectator_state", payload: state, meta, ticket: "renewed-ticket" });
  await expect(component.getByTestId("spectator-status")).toHaveText("Live · Viewing only");
  await expect(component.getByTestId("spectator-player-white")).toContainText("White player");
  await expect(component.getByTestId("spectator-player-black")).toContainText("Black player");
  await expect(component.getByTestId("board-roll-action")).toHaveCount(0);
  await expect(component.getByTestId("board-confirm-action")).toHaveCount(0);
  await component.getByTestId("spectator-board").locator('[data-point-idx="23"]').first().click({ force: true });
  const messages = await page.evaluate(() => (window as unknown as { watchSockets: FakeSocket[] }).watchSockets.flatMap(socket => socket.sent.map(text => JSON.parse(text))));
  expect(messages.every(message => ["spectator_auth", "spectator_ping"].includes(message.type))).toBe(true);
  expect(playerRequests).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem(`6b-spectator-v1:${"519fa74f-dd66-4f04-84b3-89b788b4a6f4"}`))).toBe("renewed-ticket");
});

test("a full match offers manual retry and does not open an automatic waiting loop", async ({ mount, page }) => {
  const component = await mount(screen());
  await emit(page, { type: "spectator_error", code: "full" });
  await expect(component.getByTestId("spectator-status")).toContainText("already two spectators");
  const before = await page.evaluate(() => (window as unknown as { watchSockets: FakeSocket[] }).watchSockets.length);
  await component.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { watchSockets: FakeSocket[] }).watchSockets.length)).toBe(before + 1);
});

test("lower versions cannot roll back the board and an equal version can update the score", async ({ mount, page }) => {
  const component = await mount(screen());
  await emit(page, { type: "spectator_state", payload: state, meta });
  await emit(page, { type: "spectator_state", payload: { ...state, version: 8 }, meta: { ...meta, matchScore: { white: 99, black: 99 } } });
  await expect(component.getByTestId("player-score-white")).toHaveText("2");
  await emit(page, { type: "spectator_state", payload: state, meta: { ...meta, matchScore: { white: 4, black: 3 } } });
  await expect(component.getByTestId("player-score-white")).toHaveText("4");
});

test("reconnecting keeps the board visible and uses the renewed viewing credential", async ({ mount, page }) => {
  const component = await mount(screen());
  await emit(page, { type: "spectator_state", payload: state, meta, ticket: "fresh-ticket" });
  await page.evaluate(() => (window as unknown as { watchSockets: FakeSocket[] }).watchSockets.filter(socket => socket.readyState === 1).slice(-1)[0].close());
  await expect(component.getByTestId("spectator-status")).toContainText("Reconnecting");
  await expect(component.getByTestId("spectator-board")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { watchSockets: FakeSocket[] }).watchSockets.filter(socket => socket.readyState === 1).slice(-1)[0]?.sent[0])).toBe(JSON.stringify({ type: "spectator_auth", ticket: "fresh-ticket" }));
  await emit(page, { type: "spectator_state", payload: { ...state, version: 10 }, meta });
  await expect(component.getByTestId("spectator-status")).toHaveText("Live · Viewing only");
});

test("the final board remains visible and releases its connection and credential", async ({ mount, page }) => {
  const component = await mount(screen());
  await emit(page, { type: "spectator_end", payload: { ...state, phase: "game_over", winner: "black", version: 10 }, meta });
  await expect(component.getByTestId("spectator-status")).toHaveText("The match has ended");
  await expect(component.getByTestId("spectator-board")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { watchSockets: FakeSocket[] }).watchSockets.every(socket => socket.readyState === 3))).toBe(true);
  expect(await page.evaluate(id => sessionStorage.getItem(`6b-spectator-v1:${id}`), roomId)).toBeNull();
});

test("malformed state is rejected before rendering", () => {
  expect(readSpectatorSnapshot({ ...state, points: [15] }, meta)).toBeNull();
  expect(readSpectatorSnapshot({ ...state, remaining: [9] }, meta)).toBeNull();
  expect(readSpectatorSnapshot(state, { ...meta, matchScore: { white: -1, black: 3 } })).toBeNull();
});
