// Opt-in build + private Nginx. Never reads/changes the system Nginx configuration.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const run = process.env.E2E_RUN_DIR;
if (!run || !path.isAbsolute(run)) throw new Error('Absolute E2E_RUN_DIR required');
const config = JSON.parse(fs.readFileSync(path.join(run, 'config.json'), 'utf8'));
if (config.E2E_DISPOSABLE !== true || config.run_dir !== run) throw new Error('Disposable run required');
const game = path.resolve(process.env.E2E_GAME_FRONTEND);
const tournament = path.resolve(process.env.E2E_TOURNAMENT_FRONTEND);
const quote = value => {
  if (/["\n\r\0$]/.test(value)) throw new Error('Unsafe Nginx path');
  return `"${value.replaceAll('\\', '/')}"`;
};
for (const key of Object.keys(process.env)) if (key.startsWith('VITE_')) delete process.env[key];
Object.assign(process.env, {
  VITE_API_URL: `http://127.0.0.1:${config.ports.tournament_backend}`,
  VITE_BACKEND_URL: `http://127.0.0.1:${config.ports.tournament_backend}`,
  VITE_SERVER_URL: '', VITE_GOOGLE_CLIENT_ID: '',
  VITE_TOURNAMENTS_URL: `${config.urls.tournament}/tournaments/`,
});
for (const [name, root] of [['game', game], ['tournament', tournament]]) {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
  await build({ root, configFile: path.join(root, 'vite.config.ts'),
    mode: 'production', envDir: run,
    build: { outDir: path.join(run, 'built', name), emptyOutDir: false, sourcemap: false },
  });
}
// Expose only the pure legal-move engine to the test driver, compiled separately.
// The application itself is served entirely from its production build.
const { build } = await import(pathToFileURL(path.join(game, 'node_modules/vite/dist/node/index.js')).href);
await build({ root: game, configFile: false, mode: 'production', envDir: run,
  build: { outDir: path.join(run, 'built/engine'), emptyOutDir: false,
    lib: { entry: path.join(game, 'src/lib/backgammon/engine.ts'), formats: ['es'],
      fileName: () => 'engine.js' }, },
});
const nginx = path.join(run, 'nginx');
fs.mkdirSync(nginx, { recursive: true, mode: 0o700 });
for (const directory of ['logs', 'proxy-temp', 'body-temp', 'fastcgi-temp', 'uwsgi-temp', 'scgi-temp']) {
  fs.mkdirSync(path.join(nginx, directory), { recursive: true, mode: 0o700 });
}
const proxy = (prefix, backend, targetPrefix = prefix, websocket = false) => `
location ${prefix} {
  proxy_pass http://127.0.0.1:${backend}${targetPrefix};
  proxy_http_version 1.1;
  proxy_set_header Host $http_host;
  proxy_set_header X-Forwarded-Proto https;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  ${websocket ? 'proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";' : ''}
  proxy_read_timeout 60s;
}`;
const servers = [['game', 'backgammon'], ['tournament', 'tournaments']].map(([name, base]) => `
server {
  listen 127.0.0.1:${config.ports[`${name}_frontend`]} ssl;
  server_name localhost;
  ssl_certificate ${quote(config.certificate.cert)};
  ssl_certificate_key ${quote(config.certificate.key)};
  root ${quote(path.join(run, 'built', name))};
  ${proxy('/tournaments-api/', config.ports.tournament_backend, '/api/')}
  ${proxy('/tournaments-play/', config.ports.tournament_backend, '/t/')}
  ${proxy('/api/', config.ports[`${name}_backend`], '/api/')}
  ${name === 'game' ? proxy('/backgammon/api/', config.ports.game_backend, '/api/')
    + proxy('/backgammon/ws/', config.ports.game_backend, '/ws/', true)
    + `location = /backgammon/__e2e__/engine.js {
        types { }
        default_type application/javascript;
        alias ${quote(path.join(run, 'built/engine/engine.js'))};
      }` : ''}
  location /${base}/ {
    rewrite ^/${base}/(.*)$ /$1 break;
    try_files $uri /index.html;
  }
  location / { try_files $uri /index.html; }
}`);
fs.writeFileSync(path.join(nginx, 'nginx.conf'), `
pid ${quote(path.join(nginx, 'nginx.pid'))};
error_log ${quote(path.join(run, 'nginx-error.log'))} warn;
events { worker_connections 1024; }
http {
  types {
    text/html html; text/css css; application/javascript js mjs;
    application/json json; image/png png; image/jpeg jpg jpeg;
    image/svg+xml svg; image/webp webp; image/x-icon ico;
    font/woff woff; font/woff2 woff2; application/wasm wasm;
  }
  default_type application/octet-stream;
  access_log ${quote(path.join(run, 'nginx-access.log'))};
  proxy_temp_path ${quote(path.join(nginx, 'proxy-temp'))};
  client_body_temp_path ${quote(path.join(nginx, 'body-temp'))};
  fastcgi_temp_path ${quote(path.join(nginx, 'fastcgi-temp'))};
  uwsgi_temp_path ${quote(path.join(nginx, 'uwsgi-temp'))};
  scgi_temp_path ${quote(path.join(nginx, 'scgi-temp'))};
  ${servers.join('\n')}
}
`, { mode: 0o600 });
console.log('Production builds and private Nginx config ready');
