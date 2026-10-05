// Invoked by the user's PowerShell command. Never imported by application code.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { writePerformanceReport } from './performance-report.mjs';
import { writeEnvironmentReport } from './parity-report.mjs';
import { scenarioConfig } from './scenario-config.mjs';
import { sourceVersions } from './source-versions.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, '../..');
// Verify commits before allocating databases or starting any processes.
const repositoryVersions = sourceVersions(workspace, process.env.E2E_RELEASE_MANIFEST);
const gameFrontend = path.resolve(process.env.E2E_GAME_FRONTEND || path.join(workspace, 'Backgammon Game/frontend'));
const tournamentFrontend = path.resolve(process.env.E2E_TOURNAMENT_FRONTEND || path.join(workspace, 'backgammon-tournaments'));
const diceRoot = path.resolve(process.env.E2E_DICE_ROOT || path.join(workspace, 'Backgammon Game/dice_service'));
const productionUi = process.env.E2E_UI_MODE === 'production';
const nginxExecutable = process.env.E2E_NGINX || (process.platform === 'linux' ? '/usr/sbin/nginx' : '');
if (productionUi && (!nginxExecutable || !fs.existsSync(nginxExecutable))) {
  throw new Error('Production UI requires an installed Nginx executable; pass -NginxExecutable. No services or databases were created.');
}
const runDir = path.resolve(process.argv[2] || '');
const runsRoot = path.join(here, 'runs');
if (path.dirname(runDir) !== runsRoot || fs.existsSync(runDir)) {
  throw new Error('Run directory must be a NEW direct child of docs/tournament-e2e/runs');
}
const candidates = name => name === 'game' ? [
  path.join(workspace, 'Backgammon Game/backend/.venv/Scripts/python.exe'),
] : [
  path.join(workspace, 'backgammon-tournaments-backend/.venv/Scripts/python.exe'),
  path.join(workspace, 'backgammon-tournaments-backend/venv/Scripts/python.exe'),
];
const resolvePython = name => {
  const override = process.env[`E2E_${name.toUpperCase()}_PYTHON`];
  const found = override || candidates(name).find(value => fs.existsSync(value));
  if (!found || !fs.existsSync(found)) throw new Error(`Missing ${name} Python venv; see README`);
  return found;
};
const gamePython = resolvePython('game');
const tournamentPython = resolvePython('tournament');
const redisExecutable = process.env.E2E_REDIS_EXE || [
  ...(process.platform === 'linux' ? ['/usr/bin/redis-server'] : []),
  path.join(workspace, 'tools/redis/redis-server.exe'),
  'C:/Program Files/Memurai/memurai.exe',
  'C:/Program Files/Memurai Developer/memurai.exe',
  'C:/Program Files/Redis/redis-server.exe',
].find(value => fs.existsSync(value));
if (!redisExecutable || !fs.existsSync(redisExecutable)) {
  throw new Error('An installed Redis/Memurai executable is required; no package will be installed');
}
const gameRequire = createRequire(path.join(gameFrontend, 'package.json'));
const playwrightCli = gameRequire.resolve('@playwright/test/cli');
for (const app of [gameFrontend, tournamentFrontend]) {
  if (!fs.existsSync(path.join(app, 'node_modules/vite/dist/node/index.js'))) {
    throw new Error(`Installed Vite dependencies missing: ${app}`);
  }
}

const processes = [];
const expectedExit = new Set();
let stopped = false;
let failure = null;
let config;
let liveHealth = [];
const redact = value => {
  let text = String(value);
  for (const secret of [config?.admin?.password, ...Object.values(config?.secrets || {}),
    ...Object.values(config?.postgresql || {}).map(database => database.PASSWORD)]) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  return text.replace(/([?&#]|\b)(ticket|token|access_token|refresh_token)=([^\s"'&]+)/gi, '$1$2=[REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT REDACTED]');
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function start(name, executable, args, options = {}) {
  // init alone creates the protected run directory. Do not create it first.
  const deferred = !fs.existsSync(runDir);
  const output = deferred ? null : fs.createWriteStream(path.join(runDir, `${name}.log`), { flags: 'a' });
  const initialLines = [];
  output?.on('error', error => { failure ||= error; });
  const child = spawn(executable, args, {
    cwd: options.cwd || workspace,
    env: { ...process.env, E2E_RUN_DIR: runDir, PYTHONUTF8: '1', ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    detached: process.platform !== 'win32',
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let safeBuffer = '';
  const record = chunk => {
    safeBuffer += chunk;
    let newline;
    while ((newline = safeBuffer.indexOf('\n')) >= 0) {
      const line = redact(safeBuffer.slice(0, newline + 1));
      if (output) output.write(line);
      else initialLines.push(line);
      safeBuffer = safeBuffer.slice(newline + 1);
    }
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      if (safeBuffer) {
        if (output) output.write(redact(safeBuffer));
        else initialLines.push(redact(safeBuffer));
      }
      if (output) output.end(() => resolve(code));
      else {
        if (fs.existsSync(runDir)) fs.writeFileSync(path.join(runDir, `${name}.log`), initialLines.join(''));
        else if (initialLines.length) console.error(initialLines.join(''));
        resolve(code);
      }
    });
  });
  // Background failures are handled by health checks or final verification.
  completion.catch(() => {});
  processes.push({ name, child, completion, output });
  console.log(`START ${name} PID=${child.pid || 'pending'}`);
  return processes.at(-1);
}
async function command(name, executable, args, options = {}) {
  const process = start(name, executable, args, options);
  expectedExit.add(process);
  let timer;
  const startedAt = Date.now();
  const heartbeat = name === 'playwright' ? setInterval(() => {
    console.log(`E2E STILL RUNNING elapsed_s=${Math.round((Date.now() - startedAt) / 1000)} artifacts=${runDir}; Ctrl+C stops the run`);
  }, 30000) : undefined;
  let code;
  try {
    code = options.timeoutMs === 0 ? await process.completion : await Promise.race([process.completion, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${name} exceeded its process timeout`)), options.timeoutMs ?? 120000);
    })]);
  } catch (error) {
    await terminateOwned(process);
    throw error;
  } finally { clearTimeout(timer); clearInterval(heartbeat); }
  if (code !== 0) throw new Error(`${name} failed exit=${code}; see ${name}.log`);
}
function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(300);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}
async function waitPort(port, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return;
    const ended = processes.find(item => !expectedExit.has(item) && (item.child.exitCode !== null || item.child.signalCode !== null));
    if (ended) throw new Error(`${ended.name} exited before ${label} became ready`);
    await delay(300);
  }
  throw new Error(`Timeout waiting for ${label} on port ${port}`);
}
async function waitHttps(url, timeoutMs = 60000) {
  const ca = fs.readFileSync(config.certificate.ca);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await new Promise(resolve => {
      const request = https.get(url, { ca, timeout: 3000 }, response => {
        response.resume(); resolve(response.statusCode === 200);
      });
      request.on('error', () => resolve(false));
      request.on('timeout', () => { request.destroy(); resolve(false); });
    });
    if (ready) return;
    await delay(300);
  }
  throw new Error(`Timeout waiting for HTTPS UI at ${url}`);
}
async function terminateOwned(item) {
    const { child } = item;
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
    if (process.platform === 'win32') {
      // Only terminate process trees spawned and retained by this run.
      await new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', resolve); killer.on('close', resolve);
      });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
      await Promise.race([item.completion.catch(() => {}), delay(3000)]);
      // This process group belongs exclusively to this retained child.
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await Promise.race([item.completion.catch(() => {}), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      failure ||= new Error(`Could not stop owned ${item.name} PID=${child.pid}; see run diagnostics`);
    }
}
async function shutdown() {
  if (stopped) return;
  stopped = true;
  // Stop callback producers while their HTTP receivers and proxy remain alive.
  const shutdownOrder = ['playwright', 'game-worker', 'tournament-worker',
    'game-ui', 'tournament-ui', 'game-backend', 'tournament-backend',
    'nginx-ui', 'dice', 'redis'];
  const rank = name => {
    const index = shutdownOrder.indexOf(name);
    return index < 0 ? -1 : index;
  };
  for (const item of [...processes].reverse().sort((a, b) => rank(a.name) - rank(b.name))) {
    await terminateOwned(item);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await shutdown(); process.exit(130); });
}

const bootstrap = (service, action, ...args) => [path.join(here, 'backend_bootstrap.py'), '--run-dir', runDir, '--service', service, action, ...args];

try {
  for (const port of [18805, 18806, 18573, 18574, 18679, 18807]) {
    if (await canConnect(port)) throw new Error(`E2E port ${port} is already in use; existing process was left untouched`);
  }
  fs.mkdirSync(runsRoot, { recursive: true });
  await command('initialize', gamePython, [path.join(here, 'backend_bootstrap.py'), '--run-dir', runDir, 'init']);
  config = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'));
  await command('test-harness', process.execPath, ['--test',
    path.join(here, 'scenario-config.test.mjs'), path.join(here, 'game-driver.test.mjs'),
    path.join(here, 'performance-policy.test.mjs')]);
  await command('migrate-game', gamePython, bootstrap('game', 'migrate'));
  await command('migrate-tournament', tournamentPython, bootstrap('tournament', 'migrate'));
  fs.mkdirSync(path.join(runDir, 'redis'), { recursive: true });
  const redisConfig = path.join(runDir, 'redis.conf');
  fs.writeFileSync(redisConfig, [
    'bind 127.0.0.1', `port ${config.ports.redis}`, 'protected-mode yes',
    'save ""', 'appendonly no', `dir "${path.join(runDir, 'redis').replaceAll('\\', '/')}"`,
  ].join('\n') + '\n');
  start('redis', redisExecutable, [redisConfig]);
  await waitPort(config.ports.redis, 'isolated Redis');
  for (const [service, python] of [['game', gamePython], ['tournament', tournamentPython]]) {
    await command(`inventory-${service}`, python, bootstrap(service, 'inventory'));
  }
  const comspec = process.env.ComSpec || 'C:/Windows/System32/cmd.exe';
  await command('inventory-dice', process.platform === 'win32' ? comspec : 'mix',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'mix --version'] : ['--version'], { cwd: diceRoot });
  writeEnvironmentReport(runDir, { gameFrontend, tournamentFrontend, productionUi, nginxExecutable, redisExecutable, diceRoot });
  if (config.database_mode === 'postgresql') {
    await command('test-locks-game', gamePython, bootstrap('game', 'test-locks'));
    await command('test-locks-tournament', tournamentPython, bootstrap('tournament', 'test-locks'));
  }
  await command('seed-admin', tournamentPython, bootstrap('tournament', 'seed-admin'));
  start('dice', process.platform === 'win32' ? comspec : 'mix',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'mix run --no-halt'] : ['run', '--no-halt'], {
    cwd: diceRoot, env: { PORT: String(config.ports.dice), MIX_ENV: 'dev' },
  });
  await waitPort(config.ports.dice, 'real Elixir dice service', 120000);
  start('game-backend', gamePython, bootstrap('game', 'daphne'));
  start('tournament-backend', tournamentPython, bootstrap('tournament', 'daphne'));
  await waitPort(config.ports.game_backend, 'game Daphne');
  await waitPort(config.ports.tournament_backend, 'tournament Daphne');
  if (productionUi) {
    await command('build-ui', process.execPath, [path.join(here, 'production-ui.mjs')],
      { cwd: runDir, timeoutMs: 10 * 60000 });
    const nginxArgs = ['-p', path.join(runDir, 'nginx').replaceAll('\\', '/') + '/',
      '-c', path.join(runDir, 'nginx/nginx.conf').replaceAll('\\', '/')];
    await command('check-nginx', nginxExecutable, [...nginxArgs, '-t']);
    start('nginx-ui', nginxExecutable, [...nginxArgs, '-g', 'daemon off;'], { cwd: path.join(runDir, 'nginx') });
  } else {
    start('game-ui', process.execPath, [path.join(here, 'vite-server.mjs'), 'game']);
    start('tournament-ui', process.execPath, [path.join(here, 'vite-server.mjs'), 'tournament']);
  }
  await waitHttps(`${config.urls.game}/backgammon/`);
  await waitHttps(`${config.urls.tournament}/tournaments/`);
  if (productionUi) {
    await new Promise((resolve, reject) => {
      const request = https.get(`${config.urls.game}/backgammon/__e2e__/engine.js`,
        { ca: fs.readFileSync(config.certificate.ca), timeout: 5000 }, response => {
          const mime = response.headers['content-type'] || '';
          response.resume();
          response.on('end', () => {
            if (response.statusCode !== 200 || !/^(application|text)\/javascript\b/i.test(mime)) {
              reject(new Error(`Test engine HTTP delivery failed: status=${response.statusCode} MIME=${mime}`));
            } else resolve();
          });
          response.on('error', reject);
        });
      request.on('error', reject);
      request.on('timeout', () => request.destroy(new Error('Test engine HTTP delivery timed out')));
    });
  }
  await command('check-game', gamePython, bootstrap('game', 'manage', 'check'));
  await command('check-tournament', tournamentPython, bootstrap('tournament', 'manage', 'check'));
  start('game-worker', gamePython, bootstrap('game', 'manage', 'run_tasks_worker', '--interval', '5', '--limit', '50'));
  start('tournament-worker', tournamentPython, bootstrap('tournament', 'manage', 'run_tasks_worker', '--interval', '5', '--limit', '50'));
  await command('playwright', process.execPath, [playwrightCli, 'test', '--config', path.join(here, 'playwright.config.mjs')], { timeoutMs: 0 });
  await command('replay-results', gamePython, bootstrap('game', 'replay-results'));
  for (const item of processes) {
    if (!expectedExit.has(item) && (item.child.exitCode !== null || item.child.signalCode !== null)) {
      throw new Error(`${item.name} exited during the test`);
    }
  }
} catch (error) {
  failure = error;
  console.error(`E2E FAILED: ${redact(error.message)}`);
} finally {
  // Collect health on failures too, before stopping either producer. Sampling
  // must never replace the original scenario failure.
  if (config && processes.some(item => item.name === 'game-worker')) {
    try {
      // Observe worker health while it is live. Forced Windows cleanup can leave a
      // disposable task lease running; that alone is not a runtime worker failure.
      for (const service of ['game', 'tournament']) {
        await command(`health-${service}`, service === 'game' ? gamePython : tournamentPython,
          bootstrap(service, 'status'));
        const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, `status-${service}.json`), 'utf8'));
        fs.writeFileSync(path.join(runDir, `status-live-${service}.json`), JSON.stringify(snapshot, null, 2));
        liveHealth.push({ service, tasks: snapshot.core_tasks || [] });
      }
      if (liveHealth.some(snapshot => snapshot.tasks.some(task =>
        ['failed', 'blocked'].includes(task.status) || task.with_error > 0))) {
        throw new Error('A live core background task failed, blocked, or retained a retry error');
      }
    } catch (error) { failure ||= error; }
  }
  await shutdown();
  if (config) {
    for (const service of ['game', 'tournament']) {
      try {
        await command(`status-${service}`, service === 'game' ? gamePython : tournamentPython, [
          path.join(here, 'backend_bootstrap.py'), '--run-dir', runDir, '--service', service, 'status',
        ]);
      } catch (error) { failure ||= error; }
    }
    try {
      const game = JSON.parse(fs.readFileSync(path.join(runDir, 'status-game.json'), 'utf8'));
      const tournament = JSON.parse(fs.readFileSync(path.join(runDir, 'status-tournament.json'), 'utf8'));
      const browser = JSON.parse(fs.readFileSync(path.join(runDir, 'tournament-summary.json'), 'utf8'));
      const scenario = scenarioConfig(config);
      if ([...(game.duplicate_active_task_keys || []), ...(tournament.duplicate_active_task_keys || [])].length) {
        throw new Error('Duplicate active task identities were found');
      }
      if (browser.status !== 'passed') throw new Error('Browser scenario did not report success');
      const replay = JSON.parse(fs.readFileSync(path.join(runDir, 'result-replay.json'), 'utf8'));
      if (replay.acknowledgements?.length !== scenario.resultReplays) throw new Error(`${scenario.resultReplays} signed duplicate result deliveries were not verified`);
      if (browser.concurrentAdmission?.players !== scenario.players || browser.concurrentAdmission.spreadMs > 5000) {
        throw new Error(`${scenario.players} concurrent first-round entry requests were not verified`);
      }
      if (game.linked_rooms?.length !== scenario.matches || game.linked_rooms.some(room =>
        !room.natural_bear_off || room.status !== 'completed' || room.seats.length !== 2
        || new Set(room.seats.map(seat => seat.color)).size !== 2 || room.matches.length !== 1
        || room.matches[0].end_reason !== 'move')) {
        throw new Error(`Read-only DB verification did not find ${scenario.matches} natural completed two-seat matches`);
      }
      if (game.result_delivery?.length !== scenario.matches || game.result_delivery.some(item => !item.delivered_at)) {
        throw new Error(`Not all ${scenario.matches} signed results were delivered to tournaments`);
      }
      if (tournament.fixtures?.length !== scenario.matches || tournament.fixtures.some(item =>
        item.score1 === null || item.score2 === null || !item.auto_confirmed || item.admin_result)) {
        throw new Error(`Not all ${scenario.matches} tournament fixtures were automatically confirmed`);
      }
      if (tournament.prize_awards?.length !== 1 || tournament.prize_awards[0].count !== 1
        || Number(tournament.prize_awards[0].amount) !== 100) {
        throw new Error('Prize was not awarded exactly once');
      }
      if (tournament.tournaments?.length !== 1 || tournament.tournaments[0].entry_deadline_paused) {
        throw new Error('Unexpected tournament count or disabled entry deadline');
      }
      const broken = [...(game.core_tasks || []), ...(tournament.core_tasks || [])]
        .filter(task => ['failed', 'blocked'].includes(task.status) || task.with_error > 0);
      if (broken.length) throw new Error('A core background task failed, blocked, or retained a retry error');
    } catch (error) { failure ||= error; }
  }
  const files = fs.existsSync(runDir) ? fs.readdirSync(runDir).filter(name => name.endsWith('.log')) : [];
  const serviceLogs = config ? fs.readdirSync(path.join(runDir, 'logs')).filter(name => name.endsWith('.log')).map(name => `logs/${name}`) : [];
  const lockFailures = [...files, ...serviceLogs].flatMap(name => {
    const lines = fs.readFileSync(path.join(runDir, name), 'utf8').split('\n');
    return lines.filter(line => /database is locked|event=db_lock_failed|event=sqlite_transaction_locked|deadlock detected|canceling statement due to lock timeout|could not serialize access|SQLSTATE[= :]+(?:40P01|40001|55P03)/i.test(line)).map(line => ({ file: name, line: redact(line) }));
  });
  if (lockFailures.length && !failure) failure = new Error('Database lock failure recorded during E2E');
  if (fs.existsSync(runDir)) {
    let performanceAcceptance = null;
    try {
      performanceAcceptance = writePerformanceReport(runDir).acceptance;
      if (!performanceAcceptance.passed) failure ||= new Error('Performance acceptance failed; see performance-summary.json');
    } catch (error) { failure ||= error; }
    fs.writeFileSync(path.join(runDir, 'run-summary.json'), JSON.stringify({
      passed: !failure, error: failure?.message || null, databaseLockFailures: lockFailures,
      performanceAcceptance,
      run_id: config?.run_id, ports: config?.ports,
      profile: config?.profile || 'local', sourceRoots: config?.source_roots,
      sourceCommits: config?.source_commits,
      sourceRepositories: repositoryVersions,
      uiMode: productionUi ? 'production builds + private Nginx HTTPS' : 'Vite dev servers',
      sqliteEngines: config?.sqlite_engines,
      databaseEngine: config?.database_mode || 'sqlite',
      scenario: config ? scenarioConfig(config) : null,
      postgresqlLockRegressions: config?.database_mode === 'postgresql' ? 'Required before the player scenario; inspect test-locks logs' : 'Not run on SQLite',
      legacySchemaNote: config?.profile === 'server-existing'
        ? 'An absent entry_deadline_paused DB column is reported as null, not verified false. No product migrations are injected.' : null,
      liveWorkerHealth: liveHealth,
      shutdown: 'Owned process trees terminated after live snapshots; disposable running leases after interruption are reported, not treated as application failure.',
      gameplay: 'real legal roll/move/end_turn to natural bear-off; no injected results',
      dice: 'real local Elixir service; cryptographic dice',
      exclusions: ['public production Nginx/configuration', 'production databases and external network', 'larger player counts than this run', 'physical mobile devices', 'real push/email/payments', 'optional analysis service', 'pointer-driven board gestures'],
    }, null, 2));
    const report = ['BACKGAMMON LOCAL TOURNAMENT E2E', `Finished: ${new Date().toISOString()}`, `Passed: ${!failure}`, `Error: ${failure?.message || 'none'}`, ''];
    const summaries = ['run-summary.json', 'environment-summary.json', 'runtime-game.json', 'runtime-tournament.json', 'tournament-summary.json', 'performance-summary.json', 'result-replay.json', 'status-live-game.json', 'status-live-tournament.json', 'status-game.json', 'status-tournament.json'];
    for (const name of [...summaries, ...files, ...serviceLogs]) {
      const target = path.join(runDir, name);
      if (fs.existsSync(target)) report.push(`FILE: ${name}`, redact(fs.readFileSync(target, 'utf8')), '');
    }
    fs.writeFileSync(path.join(runDir, 'report.txt'), report.join('\n'), 'utf8');
    // Export a separate allowlist of redacted text. Never export credentials,
    // certificates, databases, browser state, raw traces or HAR files.
    const share = path.join(runDir, 'share-report');
    fs.mkdirSync(share);
    for (const name of ['report.txt', 'browser-events.ndjson', ...summaries, ...files, ...serviceLogs]) {
      const source = path.join(runDir, name);
      if (!fs.existsSync(source)) continue;
      const target = path.join(share, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, redact(fs.readFileSync(source, 'utf8')), 'utf8');
    }
  }
  console.log(`E2E ARTIFACTS: ${runDir}`);
  process.exitCode = failure ? 1 : 0;
}
