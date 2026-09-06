import { test, expect } from "@playwright/experimental-ct-react";
import { GameSocketService } from "./socket";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage = null;
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.fail(1000); }
  fail(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "", wasClean: code === 1000 });
  }
  send() {}
}

const originalWebSocket = globalThis.WebSocket;
let service: GameSocketService;
test.beforeEach(() => {
  FakeWebSocket.instances = [];
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  service = new GameSocketService("ws://localhost");
});
test.afterEach(() => {
  service.disconnect();
  globalThis.WebSocket = originalWebSocket;
});

async function connect(room: string) {
  const connection = service.connect(room);
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  socket.open();
  await connection;
  return socket;
}

test("leaving cancels a scheduled reconnect", async () => {
  const socket = await connect("first");
  socket.fail();
  service.disconnect();
  await new Promise(resolve => setTimeout(resolve, 2100));
  expect(FakeWebSocket.instances).toHaveLength(1);
});

test("a previous reconnect cannot replace a new room connection", async () => {
  const first = await connect("first");
  first.fail();
  const second = await connect("second");
  await new Promise(resolve => setTimeout(resolve, 2100));
  expect(FakeWebSocket.instances).toHaveLength(2);
  expect(second.readyState).toBe(FakeWebSocket.OPEN);
});

test("reports whether an intent was actually sent", async () => {
  expect(service.send("state_update", { action: "move" })).toBe(false);
  await connect("first");
  expect(service.send("state_update", { action: "move" })).toBe(true);
});
