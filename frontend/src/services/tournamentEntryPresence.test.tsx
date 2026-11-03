import { expect, test } from "@playwright/experimental-ct-react";
import { bindTournamentEntryPresence } from "./tournamentEntryPresence";
import type { MessageHandler } from "./socket";

class EntrySocket {
  handlers = new Map<string, Set<MessageHandler>>();
  connected = true;
  sent: Array<{ type: string; payload: unknown }> = [];
  connections: Array<{ roomId: string; token: string }> = [];
  disconnects = 0;
  on(type: string, handler: MessageHandler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
  }
  off(type: string, handler: MessageHandler) { this.handlers.get(type)?.delete(handler); }
  emit(type: string, payload: unknown) {
    this.handlers.get(type)?.forEach((handler) => handler({ type, payload }));
  }
  send(type: string, payload: unknown) {
    if (!this.connected) return false;
    this.sent.push({ type, payload });
    return true;
  }
  async connect(roomId: string, token: string) {
    this.connections.push({ roomId, token });
    this.connected = true;
  }
  disconnect() { this.disconnects++; this.connected = false; }
  isConnected() { return this.connected; }
}

const original = new Map<string, PropertyDescriptor | undefined>();
let page: EventTarget & { visibilityState: string };
let browser: EventTarget;
let network: { onLine: boolean };
let socket: EntrySocket;
let binding: ReturnType<typeof bindTournamentEntryPresence> | undefined;
const acknowledgements = () => socket.sent.filter((message) => message.type === "entry_ready");
const challenge = (id: string, expiresAt = Date.now() + 5000) =>
  socket.emit("entry_challenge", { challenge: id, expiresAt });

test.beforeEach(() => {
  page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  browser = new EventTarget();
  network = { onLine: true };
  for (const [key, value] of Object.entries({ document: page, window: browser, navigator: network })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  socket = new EntrySocket();
});
test.afterEach(() => {
  binding?.dispose();
  binding = undefined;
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  original.clear();
});

test("acknowledges each current challenge only once while visible and connected", () => {
  binding = bindTournamentEntryPresence(socket, "room", "token", () => {});
  challenge("round-one");
  challenge("round-one");
  socket.emit("entry_challenge", { challenge: "missing-expiry" });
  socket.connected = false;
  challenge("disconnected");
  expect(acknowledgements()).toEqual([
    { type: "entry_ready", payload: { challenge: "round-one" } },
  ]);
});

test("a phone clock ahead of the server does not prevent challenge acknowledgement", () => {
  binding = bindTournamentEntryPresence(socket, "room", "token", () => {});
  challenge("server-round", Date.now() - 60_000);
  expect(acknowledgements()).toEqual([
    { type: "entry_ready", payload: { challenge: "server-round" } },
  ]);
});

test("hiding clears waiting readiness before closing and returning needs a new connection", () => {
  binding = bindTournamentEntryPresence(socket, "room", "token", () => {});
  challenge("first");
  page.visibilityState = "hidden";
  page.dispatchEvent(new Event("visibilitychange"));
  expect(socket.sent[socket.sent.length - 1]).toEqual({ type: "entry_not_ready", payload: {} });
  expect(socket.disconnects).toBe(1);
  challenge("hidden");
  expect(acknowledgements()).toHaveLength(1);
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  expect(socket.connections).toEqual([{ roomId: "room", token: "token" }]);
  challenge("second");
  expect(acknowledgements()).toHaveLength(2);
});

test("an initially hidden page cannot confirm startup and resumes only when visible and online", () => {
  page.visibilityState = "hidden";
  binding = bindTournamentEntryPresence(socket, "room", "token", () => {});
  expect(binding.canConnect()).toBe(false);
  challenge("hidden");
  network.onLine = false;
  page.visibilityState = "visible";
  page.dispatchEvent(new Event("visibilitychange"));
  expect(socket.connections).toEqual([]);
  expect(acknowledgements()).toEqual([]);
  network.onLine = true;
  browser.dispatchEvent(new Event("online"));
  expect(socket.connections).toHaveLength(1);
});

test("pagehide withdraws startup and a disposed old room cannot reconnect", () => {
  binding = bindTournamentEntryPresence(socket, "old-room", "token", () => {});
  browser.dispatchEvent(new Event("pagehide"));
  expect(socket.disconnects).toBe(1);
  challenge("late");
  expect(acknowledgements()).toEqual([]);
  binding.dispose();
  browser.dispatchEvent(new Event("pageshow"));
  page.dispatchEvent(new Event("visibilitychange"));
  expect(socket.connections).toEqual([]);
});

for (const event of ["room_started", "room_status"] as const) {
  test(`authoritative ${event} keeps active-game background behavior unchanged`, () => {
    binding = bindTournamentEntryPresence(socket, "room", "token", () => {});
    socket.emit(event, { status: "playing" });
    page.visibilityState = "hidden";
    page.dispatchEvent(new Event("visibilitychange"));
    browser.dispatchEvent(new Event("pagehide"));
    binding.dispose();
    expect(socket.disconnects).toBe(0);
    expect(socket.sent).toEqual([]);
  });
}
