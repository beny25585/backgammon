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
import { findWorkspace, sourceVersions } from './source-versions.mjs'
import { writePerformanceReport } from './performance-report.mjs'
import { serverAction, validateControl, cleanupSavedRun } from './remote-load-control.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const workspace = findWorkspace(here)
if (process.argv[2] === '--cleanup-only') {
  await cleanupSavedRun(process.argv[3])
  console.log('Saved run cleanup completed; reports preserved.')
  process.exit(0)
}
const [manifestFile, playerArgument = '16', checkScope = 'auto'] = process.argv.slice(2)
const playerCount = Number(playerArgument)
if (!manifestFile || ![16, 32].includes(playerCount)) throw new Error('Pass the private server-client.json and 16 or 32.')
const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), 'utf8'))
const target = manifest.identity
const copiedLoad = target?.load_cleanup_version === 1
if (copiedLoad) validateControl(manifest)
const comprehensive = checkScope === 'comprehensive' || Boolean(target?.integrations)
if (!['auto', 'comprehensive'].includes(checkScope)) throw new Error('Unsupported check scope.')
if (comprehensive && (target?.runtime_checks_version !== 1 ||
    ['analysis', 'push', 'google', 'ai'].some(name => target?.integrations?.[name] !== true))) {
  throw new Error('Comprehensive run requires all application services enabled and the updated server harness. No player accounts were created.')
}
const runId = `${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID().replaceAll('-', '').slice(-8)}`
const runDir = path.join(workspace, 'docs/tournament-e2e-integrations/runs', runId)
const runtime = { E2E_DISPOSABLE: true, profile: 'server-rehearsal', database_mode: 'postgresql',
  run_id: runId, run_dir: runDir, workspace, player_count: playerCount, recovery_checks: false,
  urls: { game: target?.origin, tournament: target?.origin }, admin: manifest.admin,
  remote_target: target, integrations: target?.integrations || {}, comprehensive_checks: comprehensive,
  entry_fee_coins: target?.integrations ? 100 : 0,
  excluded_integrations: ['email', 'payments', ...(['push', 'analysis'].filter(name => !target?.integrations?.[name]))] }
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
const harnessHash = createHash('sha256')
for (const file of manifest.harness_files) {
  if (!/^[a-z0-9][a-z0-9_.-]*\.(mjs|ps1|py|Dockerfile)$/.test(file) && file !== 'remote-engine.Dockerfile'
    && !(copiedLoad && file === 'INTEGRATIONS.he.md')) {
    throw new Error('Invalid public harness file name.')
  }
  harnessHash.update(file + '\0').update(fs.readFileSync(path.join(here, file)))
}
if (harnessHash.digest('hex') !== target.harness_sha256) throw new Error('Local and server harness versions differ. Install the matching reviewed tools and download the current server-client.json.')
const sources = sourceVersions(workspace, path.join(runDir, 'release-reference.json'), manifest.harness_files)
fs.writeFileSync(path.join(runDir, 'environment-summary.json'), JSON.stringify({
  profile: runtime.profile, target, sources, browser_machine: process.platform,
  comprehensive_checks: comprehensive,
  scope: copiedLoad ? 'Copied candidate databases; exact run-owned data is cleaned after the server audit; previous rows are protected.'
    : 'Public test listener in existing host Nginx; application images pinned by target.images; separate fresh browser databases in the existing rehearsal PostgreSQL container.',
  exclusions: runtime.excluded_integrations,
  limitation: target.validation_id
    ? 'The return link is compiled as a relative path; verify it manually on the physical device.'
    : 'The game return-to-tournaments link in the R2 image was compiled for production port 443. This scenario navigates to the configured test origin directly and does not exercise that link.',
}, null, 2))
const require = createRequire(path.join(workspace, 'Backgammon Game/frontend/package.json'))
let failure
let browserPassed = false
let serverReport
let loadBeginAttempted = false
if (copiedLoad) {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').slice(-12)
  fs.writeFileSync(path.join(runDir, 'load-plan.json'), JSON.stringify({ runId, targetSession: target.session_id,
    playerCount, usernames: Array.from({ length: playerCount }, (_, index) => `E2E${suffix}P${index + 1}`),
    tournamentName: `Disposable E2E ${suffix}` }, null, 2), { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(path.join(runDir, 'load-control.private.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 })
}
let child
const stop = () => child?.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
try {
  if (copiedLoad) {
    loadBeginAttempted = true
    await serverAction(manifest, 'begin-load', runDir, path.join(runDir, 'load-plan.json'))
  }
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
  let performance = { acceptance: { passed: false, reason: 'Performance report unavailable' } }
  try { performance = writePerformanceReport(runDir) }
  catch (error) { failure ||= error }
  if (copiedLoad && loadBeginAttempted) {
    try {
      const summaryFile = path.join(runDir, 'tournament-summary.json')
      if (!fs.existsSync(summaryFile)) fs.writeFileSync(summaryFile, JSON.stringify({ runId,
        targetSession: target.session_id, status: 'failed', matches: [], playerCount }))
      serverReport = await serverAction(manifest, 'finish-load', runDir, summaryFile)
    } catch (error) {
      failure ||= error
      const reportFile = path.join(runDir, 'share-report/cleanup-report.json')
      if (fs.existsSync(reportFile)) serverReport = JSON.parse(fs.readFileSync(reportFile, 'utf8'))
      console.error(`Load finalization needs attention. Retry: run-remote-tournament-e2e.ps1 -CleanupOnly -RunDirectory "${runDir}"`)
    }
  }
  if (!performance.acceptance.passed) failure ||= new Error('Performance acceptance failed.')
  fs.writeFileSync(path.join(runDir, 'run-summary.json'), JSON.stringify({
    passed: !failure && copiedLoad && browserPassed && performance.acceptance.passed === true && serverReport?.passed === true,
    browserPassed, performanceAcceptance: performance.acceptance,
    comprehensiveChecks: comprehensive,
    serverVerification: copiedLoad ? serverReport?.serverVerification || { passed: false, status: 'incomplete' }
      : 'required: upload tournament-summary.json and run the server audit',
    ...(copiedLoad ? { cleanup: serverReport?.cleanup || { passed: false, status: 'incomplete' } } : {}),
    runId, targetSession: target.session_id, error: failure?.message || null,
  }, null, 2))
  const share = path.join(runDir, 'share-report')
  fs.mkdirSync(share, { recursive: true })
  for (const file of ['run-summary.json', 'tournament-summary.json', 'performance-summary.json', 'environment-summary.json', 'browser-events.ndjson']) {
    if (fs.existsSync(path.join(runDir, file))) fs.copyFileSync(path.join(runDir, file), path.join(share, file))
  }
  if (!copiedLoad) console.log(`UPLOAD FOR SERVER AUDIT: ${path.join(runDir, 'tournament-summary.json')}`)
  console.log(`SAFE REPORT DIRECTORY: ${share}`)
}
process.exitCode = failure ? 1 : 0
