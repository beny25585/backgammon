// Browser load runs on the user's PC. This runner never starts local services.
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { runtimeOrigins } from './destination-policy.mjs'
import { sourceVersions } from './source-versions.mjs'
import { writePerformanceReport } from './performance-report.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = path.resolve(here, '../..')
const [manifestFile, playerArgument = '16'] = process.argv.slice(2)
const playerCount = Number(playerArgument)
if (!manifestFile || ![16, 32].includes(playerCount)) throw new Error('Pass the private server-client.json and 16 or 32.')
const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), 'utf8'))
const target = manifest.identity
const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID().replaceAll('-', '').slice(-8)}`
const runDir = path.join(here, 'runs', runId)
const runtime = { E2E_DISPOSABLE: true, profile: 'server-rehearsal', database_mode: 'postgresql',
  run_id: runId, run_dir: runDir, workspace, player_count: playerCount, recovery_checks: false,
  urls: { game: target?.origin, tournament: target?.origin }, admin: manifest.admin,
  remote_target: target, excluded_integrations: ['email', 'payments', 'push', 'analysis'] }
runtimeOrigins(runtime)
if (!/^E2EAdmin_[a-f0-9]{12}$/.test(runtime.admin?.username || '')
  || typeof runtime.admin?.password !== 'string' || runtime.admin.password.length < 32) {
  throw new Error('Expected credentials for the rehearsal-only administrator.')
}
const read = route => new Promise((resolve, reject) => {
  const request = https.get(`${target.origin}${route}`, { timeout: 10000 }, response => {
    if (response.statusCode !== 200) { response.resume(); reject(new Error(`Target verification HTTP ${response.statusCode}`)); return }
    const chunks = []
    let length = 0
    response.on('data', chunk => {
      length += chunk.length
      if (length > 1024 * 1024) request.destroy(new Error('Target verification response is too large.'))
      else chunks.push(chunk)
    })
    response.on('end', () => resolve(Buffer.concat(chunks)))
    response.on('error', reject)
  })
  request.on('timeout', () => request.destroy(new Error('Target verification timed out.')))
  request.on('error', reject)
})
// Verify the live listener and exact helper before creating accounts.
const liveIdentity = JSON.parse((await read('/__e2e__/identity')).toString('utf8'))
if (!isDeepStrictEqual(liveIdentity, target)) throw new Error('Nginx target identity differs from the prepared rehearsal.')
const engine = await read('/backgammon/__e2e__/engine.js')
if (createHash('sha256').update(engine).digest('hex') !== target.engine_sha256) throw new Error('Game helper differs from the pinned server build.')
fs.mkdirSync(path.dirname(runDir), { recursive: true })
fs.mkdirSync(runDir, { recursive: false, mode: 0o700 })
if (process.platform === 'win32') {
  const account = execFileSync('whoami.exe', [], { encoding: 'utf8', windowsHide: true }).trim()
  execFileSync('icacls.exe', [runDir, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'], { windowsHide: true, stdio: 'ignore' })
}
fs.writeFileSync(path.join(runDir, 'config.json'), JSON.stringify(runtime, null, 2), { flag: 'wx', mode: 0o600 })
fs.writeFileSync(path.join(runDir, 'release-reference.json'), JSON.stringify({ schema_version: 1, sources: target.sources }), { flag: 'wx', mode: 0o600 })
const sources = sourceVersions(workspace, path.join(runDir, 'release-reference.json'))
const harnessHash = createHash('sha256')
for (const file of manifest.harness_files) {
  if (!/^[a-z0-9][a-z0-9_.-]*\.(mjs|ps1|py|Dockerfile)$/.test(file) && file !== 'remote-engine.Dockerfile') {
    throw new Error('Invalid public harness file name.')
  }
  harnessHash.update(file + '\0').update(fs.readFileSync(path.join(here, file)))
}
if (harnessHash.digest('hex') !== target.harness_sha256) throw new Error('Local and server harness versions differ. Pull the reviewed Git commit first.')
fs.writeFileSync(path.join(runDir, 'environment-summary.json'), JSON.stringify({
  profile: runtime.profile, target, sources, browser_machine: process.platform,
  scope: 'Public test listener in existing host Nginx; application images pinned by target.images; separate fresh browser databases in the existing rehearsal PostgreSQL container.',
  exclusions: runtime.excluded_integrations,
  limitation: 'The game return-to-tournaments link in the R2 image was compiled for production port 443. This scenario navigates to the configured test origin directly and does not exercise that link.',
}, null, 2))
const require = createRequire(path.join(workspace, 'Backgammon Game/frontend/package.json'))
let failure
let browserPassed = false
let child
const stop = () => child?.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
try {
  console.log(`${playerCount} players through ${target.origin}; no local databases or services. Artifacts: ${runDir}`)
  const exitCode = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', path.join(here, 'playwright.config.mjs')], {
      cwd: workspace, windowsHide: true, stdio: 'inherit',
      env: { ...process.env, E2E_RUN_DIR: runDir, E2E_UI_MODE: 'production',
        E2E_GAME_FRONTEND: path.join(workspace, 'Backgammon Game/frontend') },
    })
    child.on('error', reject)
    child.on('close', resolve)
  })
  if (exitCode !== 0) throw new Error(`Browser scenario failed: exit=${exitCode}`)
  browserPassed = JSON.parse(fs.readFileSync(path.join(runDir, 'tournament-summary.json'), 'utf8')).status === 'passed'
  if (!browserPassed) throw new Error('Browser did not record a complete successful scenario.')
} catch (error) { failure = error }
finally {
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
  const performance = writePerformanceReport(runDir)
  if (!performance.acceptance.passed) failure ||= new Error('Performance acceptance failed.')
  fs.writeFileSync(path.join(runDir, 'run-summary.json'), JSON.stringify({
    passed: false, browserPassed, performanceAcceptance: performance.acceptance,
    serverVerification: 'required: upload tournament-summary.json and run the server audit',
    runId, targetSession: target.session_id, error: failure?.message || null,
  }, null, 2))
  const share = path.join(runDir, 'share-report')
  fs.mkdirSync(share)
  for (const file of ['run-summary.json', 'tournament-summary.json', 'performance-summary.json', 'environment-summary.json', 'browser-events.ndjson']) {
    if (fs.existsSync(path.join(runDir, file))) fs.copyFileSync(path.join(runDir, file), path.join(share, file))
  }
  console.log(`UPLOAD FOR SERVER AUDIT: ${path.join(runDir, 'tournament-summary.json')}`)
  console.log(`SAFE REPORT DIRECTORY: ${share}`)
}
process.exitCode = failure ? 1 : 0
