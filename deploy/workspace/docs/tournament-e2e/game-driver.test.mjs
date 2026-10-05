import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installGameObserver } from './game-driver.mjs';

const roomId = 'd830ca8f-9954-47b5-b537-79265f9b5a11';

async function observer() {
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
  const window = { WebSocket: Socket, location: { href: 'https://127.0.0.1/backgammon/' } };
  await installGameObserver({
    async addInitScript(initializer, options) {
      vm.runInNewContext(`(${initializer.toString()})(options)`,
        { window, options, URL, setTimeout, clearTimeout });
    },
  });
  const socket = new window.WebSocket(`wss://127.0.0.1/ws/game/${roomId}/`);
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
