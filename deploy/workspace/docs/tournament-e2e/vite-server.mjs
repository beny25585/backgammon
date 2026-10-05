// Development UI server for disposable local E2E; does not modify app config.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runDir = process.env.E2E_RUN_DIR;
const app = process.argv[2];
if (!runDir || !['game', 'tournament'].includes(app)) {
  throw new Error('Expected E2E_RUN_DIR and app game|tournament');
}
const config = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'));
if (!config.E2E_DISPOSABLE || path.resolve(config.run_dir) !== path.resolve(runDir)) {
  throw new Error('Invalid disposable E2E manifest');
}
const appRoot = app === 'game'
  ? (process.env.E2E_GAME_FRONTEND || path.join(config.workspace, 'Backgammon Game', 'frontend'))
  : (process.env.E2E_TOURNAMENT_FRONTEND || path.join(config.workspace, 'backgammon-tournaments'));
const localTarget = port => `http://127.0.0.1:${port}`;
const gameTarget = localTarget(config.ports.game_backend);
const tournamentTarget = localTarget(config.ports.tournament_backend);
const publicPort = config.ports[`${app}_frontend`];
process.env.VITE_API_URL = tournamentTarget;
process.env.VITE_BACKEND_URL = tournamentTarget;
process.env.VITE_SERVER_URL = '';
process.env.VITE_GOOGLE_CLIENT_ID = '';
process.env.VITE_TOURNAMENTS_URL = `${config.urls.tournament}/tournaments/`;
const vite = await import(pathToFileURL(path.join(appRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
const tournamentProxy = {
  '/tournaments-api': { target: tournamentTarget, rewrite: value => value.replace(/^\/tournaments-api/, '/api') },
  '/tournaments-play': { target: tournamentTarget, rewrite: value => value.replace(/^\/tournaments-play/, '/t') },
};
const proxy = app === 'game' ? {
  ...tournamentProxy,
  '/api': { target: gameTarget },
  '/backgammon/api': { target: gameTarget, rewrite: value => value.replace(/^\/backgammon/, '') },
  '/backgammon/ws': { target: gameTarget, ws: true, rewrite: value => value.replace(/^\/backgammon/, '') },
} : { ...tournamentProxy, '/api': { target: tournamentTarget } };
for (const options of Object.values(proxy)) options.xfwd = true;
const server = await vite.createServer({
  root: appRoot,
  configFile: path.join(appRoot, 'vite.config.ts'),
  mode: 'e2e',
  envDir: runDir,
  clearScreen: false,
  server: {
    host: '127.0.0.1', port: publicPort, strictPort: true, open: false,
    https: {
      cert: fs.readFileSync(config.certificate.cert),
      key: fs.readFileSync(config.certificate.key),
    },
    proxy,
    fs: { allow: [appRoot] },
  },
});
await server.listen();
console.log(`E2E ${app} frontend listening on https://127.0.0.1:${publicPort}`);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => { await server.close(); process.exit(0); });
}
