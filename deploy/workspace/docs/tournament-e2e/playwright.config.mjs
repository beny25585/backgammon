import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// This configuration never starts services or reads an application .env/database.
const runDir = process.env.E2E_RUN_DIR
if (!runDir || !path.isAbsolute(runDir)) throw new Error('Set E2E_RUN_DIR to the disposable run directory.')
const runtime = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'))
if (![true, 1, '1'].includes(runtime.E2E_DISPOSABLE)) throw new Error('Disposable runtime marker is required.')
if (path.resolve(runtime.run_dir) !== path.resolve(runDir)) throw new Error('Run directory mismatch.')
for (const key of ['game', 'tournament']) {
  const url = new URL(runtime.urls[key])
  if (url.protocol !== 'https:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`Invalid local HTTPS origin: ${key}`)
  }
}
const require = createRequire(path.join(process.env.E2E_GAME_FRONTEND || path.join(runtime.workspace, 'Backgammon Game/frontend'), 'package.json'))
const { defineConfig } = require('@playwright/test')
const browserChannel = process.env.E2E_BROWSER || 'chrome'
if (!['chrome', 'msedge', 'chromium'].includes(browserChannel)) throw new Error('Unsupported E2E_BROWSER.')

export default defineConfig({
  testDir: path.dirname(fileURLToPath(import.meta.url)),
  testMatch: 'tournament.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0, // A retry would create another tournament and obscure the first failure.
  timeout: 0,
  expect: { timeout: 0 },
  outputDir: path.join(runDir, 'playwright-artifacts'),
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    ...(!process.env.CHROMIUM_PATH && browserChannel !== 'chromium' ? { channel: browserChannel } : {}),
    headless: process.env.E2E_HEADED !== '1',
    ignoreHTTPSErrors: true, // Only the disposable loopback origins above are permitted.
    locale: 'en-US',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 0,
    navigationTimeout: 0,
    serviceWorkers: 'block',
    // Traces/HAR include signed tickets and JWT fragments; safe JSON telemetry is recorded instead.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'],
    },
  },
})
