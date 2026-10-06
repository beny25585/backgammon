/**
 * Real-socket, legal-gameplay driver for the isolated tournament E2E scenario.
 *
 * Install the observer BEFORE opening the real game UI. It observes that UI's
 * WebSocket; it neither mocks responses nor suppresses the UI's automatic moves.
 * Dice, move validation, persistence, scoring and result callbacks remain owned
 * by the running services. Only roll/move/end_turn intents are sent here.
 *
 * This validates UI admission + protocol gameplay, not pointer/drag interaction.
 * No Playwright dependency is imported, so the caller supplies Page/Context.
 */

const OBSERVER_KEY = '__tournamentE2EGame';
const ENGINE_PATH = process.env.E2E_UI_MODE === 'production'
  ? '/backgammon/__e2e__/engine.js' : '/backgammon/src/lib/backgammon/engine.ts';
const DEFAULT_TIMEOUT_MS = 600_000;
const COLORS = ['white', 'black'];

/** Observe real sockets in every subsequent document of this context. */
export async function installGameObserver(context) {
  await context.addInitScript(({ key, enginePath }) => {
    if (window[key]) return;
    const NativeWebSocket = window.WebSocket;
    const sockets = [];
    let sequence = 0;
    let enginePromise;
    const now = () => Date.now();
    const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
    const color = value => value === 'white' || value === 'black' ? value : null;
    const actionNames = new Set(['roll', 'move', 'end_turn']);
    const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    function documentTiming() {
      const performance = window.performance;
      if (!performance?.getEntriesByType || !Number.isFinite(performance.timeOrigin)) return null;
      const navigation = performance.getEntriesByType('navigation')[0];
      if (!navigation) return null;
      const epoch = value => Number.isFinite(value) && value > 0 ? performance.timeOrigin + value : null;
      const resources = performance.getEntriesByType('resource').flatMap(resource => {
        let url;
        try { url = new URL(resource.name, window.location.href); } catch { return []; }
        // Only application assets, never API URLs, query strings or fragments.
        if (url.origin !== new URL(window.location.href).origin ||
          !/^\/backgammon\/(assets\/|src\/|__e2e__\/engine\.js$)/.test(url.pathname)) return [];
        return [{ path: url.pathname, initiatorType: resource.initiatorType,
          startedAt: performance.timeOrigin + resource.startTime,
          responseStartedAt: epoch(resource.responseStart), finishedAt: epoch(resource.responseEnd),
          durationMs: resource.duration, transferBytes: resource.transferSize,
          encodedBodyBytes: resource.encodedBodySize, decodedBodyBytes: resource.decodedBodySize }];
      });
      return {
        capturedAt: now(), navigationStartedAt: performance.timeOrigin + navigation.startTime,
        responseStartedAt: epoch(navigation.responseStart), responseEndedAt: epoch(navigation.responseEnd),
        domInteractiveAt: epoch(navigation.domInteractive),
        domContentLoadedAt: epoch(navigation.domContentLoadedEventEnd), loadEventAt: epoch(navigation.loadEventEnd),
        resourceCount: resources.length, transferBytes: resources.reduce((sum, resource) => sum + resource.transferBytes, 0),
        resources: resources.sort((one, two) => two.durationMs - one.durationMs).slice(0, 40),
        resourceLimit: 40,
      };
    }
    function bothConnected(entry) {
      if (entry.timing.firstBothConnectedAt !== null || entry.socket.readyState !== NativeWebSocket.OPEN ||
        !['white', 'black'].every(seat => entry.connectedColors.includes(seat))) return;
      entry.timing.firstBothConnectedAt = now();
      // Capture once in the browser callback, before the Node driver observes it.
      entry.documentTiming = documentTiming();
    }
    const stateFields = [
      'points', 'bar', 'home', 'turn', 'dice', 'remaining', 'phase', 'cube',
      'cubeOwner', 'doubleOfferedBy', 'winner', 'winType', 'openingRoll',
      'lastMove', 'version', 'doublingEnabled', 'gameFormat',
    ];
    // Do not retain URLs, JWTs, tickets, usernames, raw messages or server errors.
    function safeState(state) {
      if (!state || typeof state !== 'object' || !Array.isArray(state.points)) return null;
      const result = {};
      for (const field of stateFields) {
        if (state[field] !== undefined) result[field] = clone(state[field]);
      }
      return result;
    }
    function safeResult(payload) {
      const result = {};
      for (const field of [
        'winner', 'loser', 'winType', 'reason', 'points', 'cube', 'whiteScore',
        'blackScore', 'targetPoints', 'matchOver', 'nextGame',
      ]) {
        if (payload?.[field] !== undefined) result[field] = payload[field];
      }
      // Result reason is a fixed protocol value, not free-form admin text.
      if (!['move', 'state_update', 'bear_off', 'time', 'leave', 'give_up',
        'disconnect', 'no_show', 'admin'].includes(result.reason)) {
        result.reason = 'other';
      }
      return result;
    }
    function errorCategory(message) {
      if (typeof message !== 'string') return 'server_error';
      if (/dice service/i.test(message)) return 'dice_service';
      if (/not your turn/i.test(message)) return 'wrong_turn';
      if (/cannot roll/i.test(message)) return 'cannot_roll';
      if (/illegal|invalid move|no legal/i.test(message)) return 'illegal_move';
      if (/room not found/i.test(message)) return 'room_missing';
      if (/not playing|not active|no active|not started/i.test(message)) return 'room_not_active';
      return 'server_error';
    }
    function record(entry, event) {
      entry.events.push({ at: now(), ...event });
      if (entry.events.length > 100) entry.events.shift();
    }
    function changed(entry) {
      entry.change++;
      for (const resume of [...entry.waiters]) resume();
    }
    function current(roomId) {
      const matching = sockets.filter(entry => !roomId || entry.roomId === roomId);
      const open = matching.filter(entry => entry.socket.readyState === NativeWebSocket.OPEN);
      return (open.length ? open : matching).at(-1) ?? null;
    }
    function view(entry, includeAdmissionTiming = false) {
      if (!entry) return null;
      return clone({
        roomId: entry.roomId,
        color: entry.color,
        socketId: entry.id,
        connected: entry.socket.readyState === NativeWebSocket.OPEN,
        connectedColors: entry.connectedColors,
        roomStarted: entry.roomStarted,
        targetPoints: entry.targetPoints,
        phase: entry.state?.phase ?? null,
        turn: entry.state?.turn ?? null,
        version: entry.state?.version ?? null,
        state: entry.state,
        initialState: entry.initialState,
        result: entry.result,
        endedAt: entry.endedAt,
        revision: entry.revision,
        change: entry.change,
        stateAt: entry.stateAt,
        pendingActions: entry.pending.map(({ action, sentAt, source }) => ({ action, sentAt, source })),
        lastSent: entry.lastSent,
        terminalMove: entry.terminalMove,
        metrics: entry.metrics,
        timing: entry.timing,
        ...(includeAdmissionTiming ? { admissionTiming: {
          ...entry.timing, document: entry.documentTiming ?? documentTiming(),
        } } : {}),
        errors: entry.errors,
        events: entry.events,
      });
    }
    function observe(socket, url, constructedAt) {
      let roomId;
      try {
        const pathname = new URL(String(url), window.location.href).pathname;
        const match = pathname.match(/\/ws\/game\/([^/]+)\/?$/);
        roomId = match?.[1];
      } catch { return; }
      if (!roomId || !idPattern.test(roomId)) return;
      const entry = {
        id: ++sequence, socket, roomId, color: null, state: null, initialState: null,
        targetPoints: null, connectedColors: [], roomStarted: false,
        result: null, revision: 0, change: 0, waiters: new Set(), stateAt: 0, lastSent: null,
        pending: [], terminalMove: null, driverSending: false, events: [], errors: [],
        timing: { socketConstructedAt: constructedAt, socketOpenedAt: null, initialStateAt: null,
          firstRoomStatusAt: null, firstBothConnectedAt: null, boardAvailableAt: null }, documentTiming: null,
        metrics: { sent: 0, driverActions: 0, appActions: 0, moves: 0, rolls: 0,
          endTurns: 0, snapshots: 0, serverErrors: 0, forbiddenActions: 0,
          closes: 0, socketErrors: 0, acknowledged: 0, maxAckMs: 0, totalAckMs: 0 },
      };
      sockets.push(entry);
      let boardObserver = null;
      function checkBoard() {
        if (entry.timing.boardAvailableAt !== null || entry.timing.initialStateAt === null || !window.document) return;
        const frame = window.document.querySelector('[data-testid="board-frame"]');
        if (!frame) return;
        const rect = frame.getBoundingClientRect();
        const style = window.getComputedStyle(frame);
        if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') {
          entry.timing.boardAvailableAt = now();
          boardObserver?.disconnect();
          changed(entry);
        }
      }
      function watchBoard() {
        if (!window.document || entry.timing.boardAvailableAt !== null) return;
        if (!boardObserver) {
          boardObserver = new window.MutationObserver(checkBoard);
          boardObserver.observe(window.document, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'style', 'hidden'] });
        }
        window.requestAnimationFrame(checkBoard);
      }
      const originalSend = socket.send;
      socket.send = function (data) {
        let message;
        try { message = typeof data === 'string' ? JSON.parse(data) : null; }
        catch { message = null; }
        const action = message?.payload?.action ?? message?.action;
        if (message?.type === 'state_update' && actionNames.has(action)) {
          const source = entry.driverSending ? 'driver' : 'app';
          const sent = { action, source, sentAt: now(), version: entry.state?.version ?? null };
          entry.pending.push(sent);
          entry.lastSent = sent;
          entry.metrics.sent++;
          entry.metrics[source === 'driver' ? 'driverActions' : 'appActions']++;
          entry.metrics[action === 'move' ? 'moves' : action === 'roll' ? 'rolls' : 'endTurns']++;
          const payload = message.payload ?? message;
          if (action === 'move' && payload.to === 'off' &&
            entry.state?.home?.[entry.color] === 14) {
            entry.terminalMove = {
              color: entry.color, from: payload.from, to: 'off',
              version: entry.state.version, homeBefore: 14, sentAt: sent.sentAt,
            };
          }
          record(entry, { kind: 'send', action, source, version: sent.version,
            ...(action === 'move' ? { from: payload.from, to: payload.to, die: payload.die } : {}) });
        } else if (message?.type === 'state_update' ||
          ['leave', 'give_up', 'game_ended', 'rematch_request'].includes(message?.type)) {
          entry.metrics.forbiddenActions++;
          record(entry, { kind: 'unexpected_client_action' });
        }
        const sent = originalSend.call(this, data);
        changed(entry);
        return sent;
      };
      socket.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(event.data); }
        catch { return; }
        if (message?.type === 'state_update') {
          const state = safeState(message.payload);
          if (!state) return;
          // Broadcast playerColor identifies the actor. Only initial identifies us.
          if (message.initial === true) {
            entry.timing.initialStateAt ??= now();
            entry.color = color(message.playerColor);
            entry.initialState = clone(state);
            watchBoard();
            entry.targetPoints = message.targetPoints ?? null;
          }
          if (entry.state && Number(state.version ?? 0) < Number(entry.state.version ?? 0)) return;
          entry.state = state;
          entry.stateAt = now();
          entry.revision++;
          entry.metrics.snapshots++;
          if (message.action && color(message.playerColor) === entry.color) {
            const index = entry.pending.findIndex(item => item.action === message.action);
            if (index >= 0) {
              const [sent] = entry.pending.splice(index, 1);
              const latency = now() - sent.sentAt;
              entry.metrics.acknowledged++;
              entry.metrics.totalAckMs += latency;
              entry.metrics.maxAckMs = Math.max(entry.metrics.maxAckMs, latency);
            }
          }
        } else if (message?.type === 'room_status') {
          entry.timing.firstRoomStatusAt ??= now();
          entry.connectedColors = (message.payload?.connectedColors ?? []).map(color).filter(Boolean);
          bothConnected(entry);
        } else if (message?.type === 'room_started') {
          entry.roomStarted = true;
        } else if (message?.type === 'game_ended') {
          entry.result = safeResult(message.payload);
          entry.endedAt = now();
          // Terminal move is acknowledged by game_ended, not state_update.
          const terminal = entry.pending.find(item => item.action === 'move');
          if (terminal && entry.terminalMove?.sentAt === terminal.sentAt) {
            const latency = now() - terminal.sentAt;
            entry.metrics.acknowledged++;
            entry.metrics.totalAckMs += latency;
            entry.metrics.maxAckMs = Math.max(entry.metrics.maxAckMs, latency);
          }
          entry.pending = [];
          record(entry, { kind: 'game_ended', ...entry.result });
        } else if (message?.type === 'error' || message?.type === 'admin_review_required') {
          entry.metrics.serverErrors++;
          const failure = {
            category: message.type === 'admin_review_required' ? 'admin_review' : errorCategory(message.message),
            action: actionNames.has(message.action) ? message.action : null,
            version: entry.state?.version ?? null,
          };
          entry.errors.push(failure);
          if (entry.errors.length > 10) entry.errors.shift();
          entry.pending = [];
          record(entry, { kind: 'server_error', ...failure });
        }
        changed(entry);
      });
      socket.addEventListener('open', () => {
        entry.timing.socketOpenedAt ??= now();
        bothConnected(entry);
        changed(entry);
      });
      socket.addEventListener('close', event => {
        boardObserver?.disconnect();
        entry.metrics.closes++;
        record(entry, { kind: 'close', code: event.code });
        changed(entry);
      });
      socket.addEventListener('error', () => {
        entry.metrics.socketErrors++;
        record(entry, { kind: 'socket_error' });
        changed(entry);
      });
    }
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args) {
        const constructedAt = now();
        const socket = Reflect.construct(target, args);
        observe(socket, args[0], constructedAt);
        return socket;
      },
    });
    window[key] = {
      inspect(roomId, includeAdmissionTiming = false) { return view(current(roomId), includeAdmissionTiming); },
      waitForChange(roomId, socketId, change, timeoutMs) {
        const entry = current(roomId);
        if (!entry || entry.id !== socketId || entry.change !== change) return Promise.resolve();
        return new Promise(resolve => {
          let timer;
          const resume = () => {
            clearTimeout(timer);
            entry.waiters.delete(resume);
            resolve();
          };
          entry.waiters.add(resume);
          // This bounds a caller's existing timeout; events always wake immediately.
          if (timeoutMs !== null) timer = setTimeout(resume, timeoutMs);
        });
      },
      async plan(roomId) {
        const entry = current(roomId);
        if (!entry?.state || !entry.color) return { kind: 'waiting' };
        const revision = entry.revision;
        const state = clone(entry.state);
        if (entry.result || state.phase === 'game_over') return { kind: 'finished' };
        if (entry.socket.readyState !== NativeWebSocket.OPEN || entry.pending.length ||
          state.turn !== entry.color) return { kind: 'waiting' };
        let intent;
        let automatic = false;
        if (state.phase === 'opening_roll' || state.phase === 'rolling') {
          intent = { action: 'roll' };
        } else if (state.phase === 'moving') {
          try { enginePromise ??= import(enginePath); }
          catch (error) { return { kind: 'engine_unavailable', error: String(error) }; }
          let engine;
          try { engine = await enginePromise; }
          catch (error) { return { kind: 'engine_unavailable', error: String(error) }; }
          if (entry.revision !== revision || entry.pending.length) return { kind: 'stale' };
          const legal = engine.allLegalMoves(state, entry.color);
          if (!legal.length) intent = { action: 'end_turn' };
          else {
            // Prefer bearing off and freeing back checkers. This is deliberately
            // a simple legal chooser, not a claim of strong backgammon strategy.
            const rank = move => {
              const distance = move.from === 'bar' ? 25 :
                entry.color === 'white' ? move.from + 1 : 24 - move.from;
              return (move.to === 'off' ? 1000 : 0) + distance * 10 + move.die;
            };
            legal.sort((a, b) => rank(b) - rank(a));
            intent = { action: 'move', ...legal[0] };
            // The UI auto-plays at the start of forced turns, then continues its
            // own acknowledged sequence. Let the real UI own those moves.
            automatic = Boolean(engine.getAutomaticMove(state, entry.color)) &&
              (!(state.lastMove?.length) ||
                (entry.lastSent?.source === 'app' && entry.lastSent.action === 'move'));
          }
        } else return { kind: 'waiting' };
        return { kind: 'intent', socketId: entry.id, revision, intent, automatic,
          stateAt: entry.stateAt, version: state.version ?? null };
      },
      send(roomId, plan) {
        const entry = current(roomId);
        if (!entry || plan.socketId !== entry.id || plan.revision !== entry.revision ||
          entry.pending.length || entry.result || entry.state?.turn !== entry.color ||
          entry.socket.readyState !== NativeWebSocket.OPEN) return false;
        if (plan.automatic) return false;
        if (!actionNames.has(plan.intent?.action)) throw new Error('E2E unsupported intent');
        // Recompute no data here. The selected legal move belongs to this exact
        // authoritative revision, checked synchronously immediately before send.
        entry.driverSending = true;
        try { entry.socket.send(JSON.stringify({ type: 'state_update', payload: plan.intent })); }
        finally { entry.driverSending = false; }
        return true;
      },
    };
  }, { key: OBSERVER_KEY, enginePath: ENGINE_PATH });
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Returns only game/protocol fields; never authentication or URL material. */
export async function inspectGame(page, { roomId, includeAdmissionTiming = false } = {}) {
  return page.evaluate(({ key, roomId, includeAdmissionTiming }) =>
    window[key]?.inspect(roomId, includeAdmissionTiming) ?? null,
  { key: OBSERVER_KEY, roomId, includeAdmissionTiming });
}

function compact(game) {
  return game ? {
    roomId: game.roomId, color: game.color, connected: game.connected,
    connectedColors: game.connectedColors, phase: game.state?.phase,
    timing: game.timing,
    version: game.state?.version, turn: game.state?.turn,
    pending: game.pendingActions?.map(item => item.action), metrics: game.metrics,
    lastSent: game.lastSent, recentEvents: game.events?.slice(-12),
    errors: game.errors, result: game.result,
  } : null;
}

function failure(reason, games) {
  return new Error(`Tournament E2E gameplay: ${reason}; ${JSON.stringify(games.map(compact))}`);
}

export async function waitRoomState(page, predicate, {
  timeoutMs = 30_000, roomId, pollMs = 100,
} = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let navigationContextRetries = 0;
  let lastNavigationAt = null;
  let game;
  while (Date.now() < deadline) {
    try {
      game = await inspectGame(page, { roomId });
    } catch (error) {
      // Real ticket handoff/reentry replaces the document. Retry only the
      // expected evaluate-context race here; gameplay still fails on navigation.
      const navigationContextGone = /Execution context was destroyed|Cannot find context with specified id/i
        .test(String(error?.message ?? ''));
      if (!navigationContextGone || page.isClosed()) throw error;
      navigationContextRetries++;
      lastNavigationAt = Date.now();
      await delay(pollMs);
      continue;
    }
    if (game && predicate(game)) return game;
    if (game?.metrics.serverErrors) throw failure('server refused game entry', [game]);
    await delay(pollMs);
  }
  const navigationAge = lastNavigationAt == null ? 'none' : Date.now() - lastNavigationAt;
  throw failure(`timed out waiting for room state after ${Date.now() - startedAt}ms ` +
    `(navigationContextRetries=${navigationContextRetries}, lastNavigationAgoMs=${navigationAge})`, [game]);
}

/** Resolves after this real socket receives its authenticated initial snapshot. */
export async function waitForGame(page, options = {}) {
  return waitRoomState(page, game => game.connected && COLORS.includes(game.color) &&
    Array.isArray(game.state?.points), options);
}

function assertInitialBoard(games) {
  const expected = Array(24).fill(0);
  expected[23] = 2; expected[12] = 5; expected[7] = 3; expected[5] = 5;
  expected[0] = -2; expected[11] = -5; expected[16] = -3; expected[18] = -5;
  for (const game of games) {
    const state = game.initialState;
    if (JSON.stringify(state?.points) !== JSON.stringify(expected) ||
      state?.home?.white !== 0 || state?.home?.black !== 0 ||
      state?.bar?.white !== 0 || state?.bar?.black !== 0 ||
      !['waiting', 'opening_roll', 'opening_result'].includes(state.phase)) {
      throw failure('expected a fresh standard board, not an injected/replayed position', games);
    }
    if (game.targetPoints !== 1) throw failure('scenario requires targetPoints=1', games);
  }
}

/**
 * Complete one actual match through its two already-admitted browser pages.
 * The spec owns tournament APIs, settlement/progression assertions and cleanup.
 * No second socket, administrative result or test-only server route is used.
 */
export async function driveMatch(pages, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  actionTimeoutMs = 20_000,
  maxActions = 3000,
  initialGames,
  onObservation,
  allowedOrigins,
} = {}) {
  if (!Array.isArray(pages) || pages.length !== 2) throw new Error('driveMatch requires two real game pages');
  const permitted = await Promise.all(pages.map(page => page.evaluate(origins => origins
    ? origins.includes(window.location.origin)
    : ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname), allowedOrigins)));
  if (permitted.some(value => !value)) throw new Error('Gameplay destination differs from the isolated runtime');
  let games = await Promise.all(pages.map(page => waitForGame(page)));
  const roomId = games[0].roomId;
  if (games[1].roomId !== roomId || new Set(games.map(game => game.color)).size !== 2) {
    throw failure('players did not receive opposite seats in the same room', games);
  }
  // The explicit reload/reentry scenario passes the server-observed snapshots
  // captured before navigation. A caller flag cannot bypass the board proof.
  const initialProof = initialGames ?? games;
  if (!Array.isArray(initialProof) || initialProof.length !== 2 ||
    games.some(game => !initialProof.some(proof =>
      proof.roomId === game.roomId && proof.color === game.color && proof.targetPoints === game.targetPoints))) {
    throw failure('initial board evidence does not match the admitted room and seats', games);
  }
  assertInitialBoard(initialProof);
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  let previousProgress = '';
  let previousObservation = '';
  let firstBothConnectedAt = null;
  let admissionTiming = null;
  let driverActions = 0;
  const initialSocketIds = games.map(game => game.socketId);
  const waitForChange = async index => {
    const game = games[index];
    const remaining = Math.min(startedAt + timeoutMs, lastProgressAt + actionTimeoutMs) - Date.now();
    if (remaining <= 0) return;
    await pages[index].evaluate(({ key, roomId, socketId, change, timeoutMs }) =>
      window[key].waitForChange(roomId, socketId, change, timeoutMs),
    { key: OBSERVER_KEY, roomId, socketId: game.socketId, change: game.change,
      timeoutMs: Number.isFinite(remaining) ? remaining : null });
  };

  while (Date.now() - startedAt < timeoutMs) {
    games = await Promise.all(pages.map(page => inspectGame(page, {
      roomId, includeAdmissionTiming: firstBothConnectedAt === null,
    })));
    if (games.some(game => !game)) throw failure('game document/observer disappeared', games);
    if (games.some((game, index) => game.socketId !== initialSocketIds[index])) {
      throw failure('socket reconnected during the match; inspect server/client logs', games);
    }
    if (games.some(game => game.metrics.serverErrors || game.metrics.forbiddenActions)) {
      throw failure('server rejection or unexpected client action', games);
    }
    if (games.some(game => game.metrics.closes || game.metrics.socketErrors)) {
      throw failure('game socket closed or failed', games);
    }
    const progress = games.map(game => `${game.state?.version}:${game.state?.phase}:${Boolean(game.result)}`).join('|');
    if (progress !== previousProgress) {
      previousProgress = progress;
      lastProgressAt = Date.now();
    }
    const observation = games.map(game => `${game.state?.phase}:${game.state?.turn}:${Boolean(game.result)}`).join('|');
    // The DOM can become visible after the first both-connected callback.
    // Preserve the original admission clock while retaining this later milestone.
    if (admissionTiming) {
      for (const seat of admissionTiming.seats) {
        seat.boardAvailableAt ??= games.find(game => game.color === seat.color)?.timing?.boardAvailableAt ?? null;
      }
    }
    if (observation !== previousObservation) {
      previousObservation = observation;
      await onObservation?.({ event: 'game_progress', elapsedMs: Date.now() - startedAt,
        games: games.map(compact) });
    }
    if (games.every(game => game.result?.matchOver === true)) {
      const result = games[0].result;
      const winnerColor = result.winner;
      const winner = games.find(game => game.color === winnerColor);
      if (!COLORS.includes(winnerColor) || games[1].result.winner !== winnerColor ||
        games.some(game => game.result.reason !== 'move' || game.result.targetPoints !== 1) ||
        winner?.terminalMove?.homeBefore !== 14 || winner.terminalMove.to !== 'off') {
        throw failure(`match did not finish through an observed legal final bear-off ` +
          `(reasons=${games.map(game => game.result.reason).join(',')}, winner=${winnerColor})`, games);
      }
      // The server sends game_ended instead of a final state_update. The last
      // accepted off intent from home=14 + reason=move proves natural scoring;
      // the supervisor additionally checks persisted final home=15 read-only.
      const metrics = {
        elapsedMs: Date.now() - startedAt,
        firstBothConnectedAfterMs: firstBothConnectedAt == null ? null : firstBothConnectedAt - startedAt,
        firstBothConnectedAt,
        admissionTiming,
        driverActions,
        seats: games.map(game => ({ color: game.color, ...game.metrics })),
      };
      return { roomId, winnerColor, result, metrics, endedAt: Math.min(...games.map(game => game.endedAt)),
        moves: games.reduce((sum, game) => sum + game.metrics.moves, 0),
        rolls: games.reduce((sum, game) => sum + game.metrics.rolls, 0),
        terminalMove: winner.terminalMove };
    }
    if (games.some(game => game.result && game.result.matchOver !== true)) {
      throw failure('unexpected multi-game result in one-point scenario', games);
    }
    if (Date.now() - lastProgressAt > actionTimeoutMs) {
      throw failure('no authoritative progress within action timeout', games);
    }
    if (games.reduce((sum, game) => sum + game.metrics.sent, 0) >= maxActions) {
      throw failure('legal gameplay action budget exceeded', games);
    }
    if (!games.every(game => game.connected && COLORS.every(color => game.connectedColors.includes(color)))) {
      const missing = games.findIndex(game => !game.connected ||
        !COLORS.every(color => game.connectedColors.includes(color)));
      await waitForChange(missing);
      continue;
    }
    if (firstBothConnectedAt === null) {
      firstBothConnectedAt = Date.now();
      admissionTiming = { observedAt: firstBothConnectedAt,
        seats: games.map(game => ({ color: game.color, ...game.admissionTiming })) };
      await onObservation?.({ event: 'game_admission_observed', admissionTiming });
    }
    // Never overlap our own or UI-generated requests. Both pages must observe
    // the same authoritative version before the next turn is driven.
    if (games.some(game => game.pendingActions.length) ||
      games[0].state.version !== games[1].state.version || games.some(game => game.result)) {
      const newestVersion = Math.max(...games.map(game => game.state.version));
      const waiting = games.findIndex(game => game.pendingActions.length ||
        game.state.version < newestVersion || !game.result && games.some(other => other.result));
      await waitForChange(waiting < 0 ? 0 : waiting);
      continue;
    }
    const actor = games.findIndex(game => game.color === game.state.turn);
    if (actor < 0) throw failure('server turn is not a seated color', games);
    const game = games[actor];
    const plan = await pages[actor].evaluate(({ key, roomId }) => window[key].plan(roomId),
      { key: OBSERVER_KEY, roomId });
    if (plan.kind === 'engine_unavailable') {
      throw failure(`Test legal-move engine unavailable: ${plan.error || 'unknown import failure'}`, games);
    }
    if (plan.kind !== 'intent') {
      await waitForChange(actor);
      continue;
    }
    // Forced moves belong to the UI's real timers and animation lifecycle.
    // A fixed grace period can expire while an animation is still running and
    // cause a duplicate move. Wait for its send/state event instead.
    if (plan.automatic) {
      await waitForChange(actor);
      continue;
    }
    const sent = await pages[actor].evaluate(({ key, roomId, plan }) => window[key].send(roomId, plan),
      { key: OBSERVER_KEY, roomId, plan });
    if (sent) driverActions++;
  }
  throw failure('match timed out before natural completion', games);
}

/** Named-seat convenience interface for the Playwright scenario. */
export async function playMatch({ whitePage, blackPage, ...options }) {
  return driveMatch([whitePage, blackPage], options);
}
