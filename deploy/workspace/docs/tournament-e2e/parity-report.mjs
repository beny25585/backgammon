// Compare public manifests from this SAME harness, never production .env files.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { sourceVersions } from './source-versions.mjs';

function fingerprint(root) {
  const digest = crypto.createHash('sha256');
  let files = 0;
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.cache', 'test-results', 'playwright-report', 'deps', '_build']);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.env')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!ignored.has(entry.name)) visit(file); }
      else if (/\.(?:ts|tsx|vue|css|html|json|ex|exs)$/.test(entry.name) || ['pnpm-lock.yaml', 'package-lock.json', 'mix.lock'].includes(entry.name)) {
        digest.update(path.relative(root, file).replaceAll('\\', '/') + '\0');
        digest.update(crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n')).digest());
        files++;
      }
    }
  }
  visit(root);
  return { sha256: digest.digest('hex'), files };
}

function frontend(root) {
  const packages = {};
  for (const name of ['vite', 'react', 'vue', 'typescript', '@playwright/test']) {
    const file = path.join(root, 'node_modules', name, 'package.json');
    packages[name] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).version : null;
  }
  return { source: fingerprint(root), packages };
}

function differences(actual, expected, prefix = '') {
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    return [...new Set([...Object.keys(actual), ...Object.keys(expected)])].sort()
      .flatMap(key => differences(actual[key], expected[key], prefix ? `${prefix}.${key}` : key));
  }
  return actual === expected ? [] : [{ field: prefix, local: actual ?? null, reference: expected ?? null }];
}

export function writeEnvironmentReport(runDir, options) {
  const config = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'));
  const backends = Object.fromEntries(['game', 'tournament'].map(service =>
    [service, JSON.parse(fs.readFileSync(path.join(runDir, `runtime-${service}.json`), 'utf8'))]));
  const nginx = options.productionUi
    ? spawnSync(options.nginxExecutable, ['-v'], { encoding: 'utf8', windowsHide: true, timeout: 10000 }) : null;
  if (nginx && (nginx.error || nginx.status !== 0)) throw new Error('Nginx version preflight failed');
  const comparable = {
    schema: 1, node: process.versions.node, databaseEngine: config.database_mode || 'sqlite',
    uiMode: options.productionUi ? 'production' : 'dev',
    nginxVersion: nginx ? `${nginx.stdout}${nginx.stderr}`.trim() : null,
    backends: Object.fromEntries(Object.entries(backends).map(([service, value]) => [service, {
      python: value.python, packages: value.packages, source: value.source,
      postgresql: value.postgresql || null, connectionMaxAge: value.connection_max_age,
      ...(service === 'game' ? { websocketDatabaseWorkers: value.websocket_database_workers } : {}),
    }])),
    redis: backends.game.redis,
    dice: { mixEnvironment: 'dev', source: fingerprint(options.diceRoot),
      mixVersion: fs.readFileSync(path.join(runDir, 'inventory-dice.log'), 'utf8').match(/\bMix ([\d.]+)/)?.[1] || null,
      otpVersion: fs.readFileSync(path.join(runDir, 'inventory-dice.log'), 'utf8').match(/Erlang\/OTP (\d+)/)?.[1] || null },
    frontends: { game: frontend(options.gameFrontend), tournament: frontend(options.tournamentFrontend) },
    workers: { game: { processes: 1, intervalSeconds: 5, limit: 50 },
      tournament: { processes: 1, intervalSeconds: 5, limit: 50 } },
    daphneProcesses: { game: 1, tournament: 1 },
  };
  const report = { createdAt: new Date().toISOString(), target: 'server after PostgreSQL migration',
    sourceRepositories: sourceVersions(config.workspace, process.env.E2E_RELEASE_MANIFEST),
    comparable, host: { os: os.platform(), release: os.release(), architecture: os.arch(), cpuCount: os.cpus().length },
    serverComparison: { status: 'not_verified', differences: [] },
    remainingChecks: ['Effective server Nginx routes/timeouts and service worker counts',
      'Redis configuration and effective Elixir deployment mode', 'Linux scheduling, network and server CPU/memory',
      'Real analysis, push, email and payment services are excluded'],
  };
  const referenceFile = process.env.E2E_SERVER_REFERENCE;
  if (referenceFile) {
    // Compare only the generated allowlisted fields; never copy arbitrary input
    // (which might contain secrets) into the shareable report.
    const reference = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
    if (reference.comparable?.schema !== 1) throw new Error('Server reference must be environment-summary.json from this harness');
    const drift = differences(comparable, reference.comparable);
    report.serverComparison = { status: drift.length ? 'mismatch' : 'compared_fields_match',
      differences: drift.map(item => ({ field: item.field })),
      hostOsMatches: report.host.os === reference.host?.os };
  }
  fs.writeFileSync(path.join(runDir, 'environment-summary.json'), JSON.stringify(report, null, 2));
  if (report.serverComparison.status === 'mismatch') {
    throw new Error('Server reference drift found; inspect environment-summary.json before running the scenario');
  }
}
