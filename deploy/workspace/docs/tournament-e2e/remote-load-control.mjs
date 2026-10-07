import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export function validateControl(manifest) {
  const identity = manifest.identity
  const control = manifest.load_control
  const root = '/home/dev/backgammon-project'
  const project = `${root}/deploy/backgammon-deploy/${identity.image_tag}`
  const rehearsal = `${root}/backups/backgammon-backups/validation-${identity.validation_id}/docker-rehearsal`
  if (identity.load_cleanup_version !== 1 || !/^[a-f0-9]{32}$/.test(identity.validation_id || '')
    || !/^[a-f0-9]{40}$/.test(identity.tools_revision || '')
    || !/^backgammon-[a-z0-9-]{1,64}$/.test(identity.image_tag || '')
    || control?.destination !== 'administrator@38.247.146.17'
    || control.project !== project || control.rehearsal !== rehearsal
    || control.tools !== `${root}/sources/backgammon/deploy/workspace/docs/tournament-e2e`) {
    throw new Error('Unexpected copied candidate control destination or paths.')
  }
  return control
}

function command(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: 'inherit', windowsHide: true })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`${file} exited with code ${code}`)))
  })
}

export async function serverAction(manifest, action, runDir, file) {
  if (!['begin-load', 'finish-load', 'cleanup-load'].includes(action)) throw new Error('Invalid copied load action.')
  const control = validateControl(manifest)
  const plan = JSON.parse(fs.readFileSync(path.join(runDir, 'load-plan.json'), 'utf8'))
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(plan.runId || '') || plan.targetSession !== manifest.identity.session_id) {
    throw new Error('Load control plan differs from the manifest.')
  }
  const remote = `${control.rehearsal}/browser-load/client-${plan.runId}.json`
  if (file) await command('scp.exe', [file, `${control.destination}:${remote}`])
  // Fixed program plus base64 JSON avoids shell interpretation of data/paths.
  const args = Buffer.from(JSON.stringify({ control, action, remote: file ? remote : null,
    runId: plan.runId, targetSession: plan.targetSession })).toString('base64')
  const program = `import base64,json,subprocess,sys
from pathlib import Path
job=json.loads(base64.b64decode('${args}'))
control=job['control']
state=Path(control['rehearsal'])/'browser-load'
session=json.loads((state/'session.json').read_text())
if session['identity']['session_id'] != job['targetSession']:
    raise ValueError('Server session changed')
if job['action'] != 'begin-load':
    if not (state/'load-run.lock').exists():
        report=json.loads((state/('load-'+job['runId']+'-report.json')).read_text())
        if report.get('runId') == job['runId'] and report.get('targetSession') == job['targetSession'] and report.get('cleanup',{}).get('passed') is True:
            sys.exit(0)
        raise ValueError('No matching completed cleanup or active load lock')
    lock=json.loads((state/'load-run.lock').read_text())
    if lock != {'runId':job['runId'],'targetSession':job['targetSession']}:
        raise ValueError('Another load owns the server lock')
command=['python3',control['tools']+'/server_rehearsal.py',job['action'],'--copied-load','--project',control['project'],'--rehearsal',control['rehearsal']]
if job['remote']:
    command += ['--summary',job['remote']]
sys.exit(subprocess.call(command))
`
  const encoded = Buffer.from(program).toString('base64')
  let error
  try {
    await command('ssh.exe', ['-t', control.destination, `printf %s ${encoded} | base64 --decode | python3`])
  } catch (value) { error = value }
  if (action !== 'begin-load') {
    const share = path.join(runDir, 'share-report')
    fs.mkdirSync(share, { recursive: true })
    // The report is required even when audit/cleanup returns a failure exit code.
    await command('scp.exe', [`${control.destination}:${control.rehearsal}/browser-load/load-${plan.runId}-report.json`,
      path.join(share, 'cleanup-report.json')])
    const report = JSON.parse(fs.readFileSync(path.join(share, 'cleanup-report.json'), 'utf8'))
    if (report.runId !== plan.runId || report.targetSession !== plan.targetSession) throw new Error('Downloaded cleanup report differs.')
    if (report.cleanup?.passed !== true) throw new Error('Server cleanup is incomplete; retry CleanupOnly for this run.')
    if (action === 'finish-load' && report.serverVerification?.status !== 'skipped') {
      for (const [source, destination] of [['operations-', 'server-operations.json'], ['entry-flow-', 'entry-flow-server.json']]) {
        try {
          await command('scp.exe', [`${control.destination}:${control.rehearsal}/browser-load/audit/${source}${plan.runId}.json`, path.join(share, destination)])
        } catch (value) { error ||= value }
      }
    }
    if (!error) return report
  }
  if (error) throw error
}

export async function cleanupSavedRun(runDir) {
  runDir = path.resolve(runDir)
  const runtime = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'load-control.private.json'), 'utf8'))
  const plan = JSON.parse(fs.readFileSync(path.join(runDir, 'load-plan.json'), 'utf8'))
  if (runtime.run_dir !== runDir || runtime.run_id !== plan.runId
    || runtime.remote_target.session_id !== manifest.identity.session_id) throw new Error('Saved load directory identity differs.')
  const report = await serverAction(manifest, 'cleanup-load', runDir)
  const summaryFile = path.join(runDir, 'run-summary.json')
  const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : { runId: plan.runId, passed: false }
  summary.cleanup = report.cleanup
  // Retrying cleanup alone never turns a failed/unverified scenario into a pass.
  summary.passed = summary.passed === true && report.cleanup.passed === true
  const encoded = JSON.stringify(summary, null, 2) + '\n'
  fs.writeFileSync(summaryFile, encoded)
  fs.writeFileSync(path.join(runDir, 'share-report/run-summary.json'), encoded)
}
