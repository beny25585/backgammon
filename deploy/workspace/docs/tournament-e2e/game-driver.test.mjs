import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installGameObserver } from './game-driver.mjs';

const roomId = 'd830ca8f-9954-47b5-b537-79265f9b5a11';

async function observer({ clock = Date.now, performance, windowExtras = {} } = {}) {
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    listeners = new Map();
    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }
    emit(type, event) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
  }
  const window = { WebSocket: Socket, location: { href: 'https://127.0.0.1/backgammon/' }, performance, ...windowExtras };
  await installGameObserver({
    async addInitScript(initializer, options) {
      vm.runInNewContext(`(${initializer.toString()})(options)`,
        { window, options, URL, setTimeout, clearTimeout, Date: { now: clock } });
    },
  });
  const socket = new window.WebSocket(`wss://127.0.0.1/ws/game/${roomId}/?token=private-token`);
  const api = window.__tournamentE2EGame;
  const snapshot = (version, initial = false) => socket.emit('message', { data: JSON.stringify({
    type: 'state_update', initial, playerColor: 'white', action: initial ? undefined : 'roll',
    targetPoints: 1, payload: { points: Array(24).fill(0), turn: 'white', phase: 'rolling', version },
  }) });
  snapshot(0, true);
  return { api, socket, snapshot };
}

test('state acknowledgement wakes the driver immediately without a grace timer', { timeout: 1000 }, async () => {
  const { api, snapshot } = await observer();
  const before = api.inspect(roomId);
  const wake = api.waitForChange(roomId, before.socketId, before.change, null);
  snapshot(1);
  await wake;
  assert.equal(api.inspect(roomId).version, 1);
});

test('an event before subscription cannot be lost', { timeout: 1000 }, async () => {
  const { api, snapshot } = await observer();
  const before = api.inspect(roomId);
  snapshot(1);
  await api.waitForChange(roomId, before.socketId, before.change, null);
});

test('the UI send wakes the driver and keeps it waiting for acknowledgement', { timeout: 1000 }, async () => {
  const { api, socket } = await observer();
  const before = api.inspect(roomId);
  const wake = api.waitForChange(roomId, before.socketId, before.change, null);
  socket.send(JSON.stringify({ type: 'state_update', payload: { action: 'roll' } }));
  await wake;
  assert.equal(api.inspect(roomId).pendingActions.length, 1);
  assert.equal((await api.plan(roomId)).kind, 'waiting');
});

test('the driver cannot send a UI-owned automatic move or a stale plan', async () => {
  const { api, socket, snapshot } = await observer();
  const plan = await api.plan(roomId);
  assert.equal(api.send(roomId, { ...plan, automatic: true }), false);
  snapshot(1);
  assert.equal(api.send(roomId, plan), false);
  assert.equal(socket.sent.length, 0);
});

test('socket errors wake the driver even without a newer state', { timeout: 1000 }, async () => {
  const { api, socket } = await observer();
  const before = api.inspect(roomId);
  const wake = api.waitForChange(roomId, before.socketId, before.change, null);
  socket.emit('error', {});
  await wake;
  assert.equal(api.inspect(roomId).metrics.socketErrors, 1);
});

test('admission callback times survive later states, repeated status and a full event buffer', async () => {
  let clock = 1000;
  const { api, socket, snapshot } = await observer({ clock: () => clock });
  clock = 1100;
  socket.emit('open', {});
  clock = 1200;
  socket.emit('message', { data: JSON.stringify({ type: 'room_status', payload: { connectedColors: ['white'] } }) });
  assert.equal(api.inspect(roomId).timing.firstBothConnectedAt, null);
  clock = 1400;
  const both = () => socket.emit('message', { data: JSON.stringify({ type: 'room_status',
    payload: { connectedColors: ['white', 'black'] } }) });
  both();
  clock = 9000;
  both();
  for (let index = 0; index < 150; index++) {
    socket.send(JSON.stringify({ type: 'state_update', payload: { action: 'roll' } }));
    snapshot(index + 1);
  }
  const game = api.inspect(roomId, true);
  assert.equal(game.events.length, 100);
  assert.equal(game.timing.socketConstructedAt, 1000);
  assert.equal(game.timing.socketOpenedAt, 1100);
  assert.equal(game.timing.initialStateAt, 1000);
  assert.equal(game.timing.firstRoomStatusAt, 1200);
  assert.equal(game.timing.firstBothConnectedAt, 1400);
});

test('a both-connected payload cannot stamp an unopened socket', async () => {
  const { api, socket } = await observer();
  socket.readyState = 0;
  socket.emit('message', { data: JSON.stringify({ type: 'room_status', payload: { connectedColors: ['white', 'black'] } }) });
  assert.equal(api.inspect(roomId).timing.firstBothConnectedAt, null);
  socket.readyState = 1;
  socket.emit('open', {});
  assert.ok(api.inspect(roomId).timing.firstBothConnectedAt !== null);
});

test('board availability waits for visible DOM and preserves the first timestamp', async () => {
  let clock = 1000;
  let visible = false;
  let callback;
  let disconnected = 0;
  const frame = { getBoundingClientRect: () => ({ width: visible ? 400 : 0, height: 300 }) };
  const { api, socket } = await observer({ clock: () => clock, windowExtras: {
    document: { querySelector: () => frame },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    MutationObserver: class { constructor(listener) { callback = listener; } observe() {} disconnect() { disconnected++; } },
    requestAnimationFrame: listener => listener(),
  } });
  assert.equal(api.inspect(roomId).timing.boardAvailableAt, null);
  clock = 1500;
  visible = true;
  callback();
  assert.equal(api.inspect(roomId).timing.boardAvailableAt, 1500);
  clock = 9000;
  callback();
  assert.equal(api.inspect(roomId).timing.boardAvailableAt, 1500);
  assert.equal(api.inspect(roomId).timing.initialStateAt, 1000);
  assert.equal(socket.sent.length, 0);
  assert.equal(disconnected, 1);
});

test('document evidence excludes credentials, API traffic and off-origin assets', async () => {
  let clock = 1000;
  const asset = name => ({ name, initiatorType: 'script', startTime: 5, responseStart: 10, responseEnd: 50,
    duration: 45, transferSize: 200, encodedBodySize: 100, decodedBodySize: 300 });
  const navigation = { startTime: 0, responseStart: 10, responseEnd: 30, domInteractive: 0,
    domContentLoadedEventEnd: 0, loadEventEnd: 0 };
  const resources = [asset('https://127.0.0.1/backgammon/assets/main.js?ticket=secret#private'),
    asset('https://127.0.0.1/api/link/enter/?ticket=secret'), asset('https://outside.example/backgammon/assets/main.js')];
  const performance = { timeOrigin: 900, getEntriesByType: type => type === 'navigation' ? [navigation] : resources };
  const { api, socket } = await observer({ clock: () => clock, performance });
  assert.equal(api.inspect(roomId).admissionTiming, undefined);
  socket.emit('open', {});
  clock = 1400;
  socket.emit('message', { data: JSON.stringify({ type: 'room_status', payload: { connectedColors: ['white', 'black'] } }) });
  clock = 9000;
  resources.push(asset('https://127.0.0.1/backgammon/assets/later.js'));
  const timing = api.inspect(roomId, true).admissionTiming;
  assert.equal(timing.document.capturedAt, 1400);
  assert.equal(timing.document.navigationStartedAt, 900);
  assert.equal(timing.document.responseEndedAt, 930);
  assert.equal(timing.document.domContentLoadedAt, null);
  assert.equal(timing.document.resourceCount, 1);
  assert.equal(timing.document.resources[0].path, '/backgammon/assets/main.js');
  assert.equal(timing.document.transferBytes, 200);
  assert.doesNotMatch(JSON.stringify(timing), /secret|private|ticket|token|outside\.example|later\.js/);
});
