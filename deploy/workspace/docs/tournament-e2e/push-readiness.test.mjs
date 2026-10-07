import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushReadiness } from './push-readiness.mjs'

const options = { copied: true, runId: 'current-run', sessionId: 'a'.repeat(32) }
function fixture() {
  return {
    health: { issues: [{ code: 'failed', count: 37 }], last_worker_seen_at: '2026-10-07T11:24:09Z' },
    snapshot: { kind: 'tournaments', session_id: options.sessionId, observed_at: '2026-10-07T11:24:10Z',
      push: { last_seen_at: '2026-10-07T11:24:09Z', expected_by: '2026-10-07T11:26:09Z' },
      copied_push_health: { run_id: options.runId, target_session: options.sessionId,
        new_issues: [], inherited_issues: [{ code: 'failed', count: 37 }] } },
  }
}
test('inherited copied queue failures remain visible without blocking this run', () => {
  const { health, snapshot } = fixture()
  const result = pushReadiness(health, snapshot, options)
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.inheritedIssues, health.issues)
  assert.deepEqual(result.globalIssues, health.issues)
})
test('new failed, retrying and delayed rows remain blocking', () => {
  for (const code of ['failed', 'retrying', 'delayed']) {
    const { health, snapshot } = fixture()
    snapshot.copied_push_health.new_issues = [{ code, count: 1 }]
    assert.deepEqual(pushReadiness(health, snapshot, options).issues, [{ code, count: 1 }])
  }
})
test('configuration, library, stopped worker and unknown global issues remain blocking', () => {
  for (const code of ['configuration_missing', 'library_missing', 'worker_stopped', 'unknown']) {
    const { health, snapshot } = fixture()
    health.issues.push({ code })
    assert.deepEqual(pushReadiness(health, snapshot, options).issues, [{ code }])
  }
})
test('fresh database runs keep strict global queue acceptance', () => {
  const { health } = fixture()
  assert.deepEqual(pushReadiness(health, null, { copied: false }).issues, health.issues)
})
test('missing, wrong run, wrong session or wrong role evidence cannot exempt queue failures', () => {
  for (const mutate of [s => { delete s.copied_push_health }, s => { s.kind = 'game' },
    s => { s.session_id = 'b'.repeat(32) }, s => { s.copied_push_health.run_id = 'old-run' },
    s => { s.copied_push_health.target_session = 'b'.repeat(32) }]) {
    const { health, snapshot } = fixture()
    mutate(snapshot)
    assert.throws(() => pushReadiness(health, snapshot, options), /baseline/)
  }
})
test('expired heartbeat and malformed queue evidence are rejected', () => {
  const { health, snapshot } = fixture()
  snapshot.push.expected_by = snapshot.observed_at
  assert.throws(() => pushReadiness(health, snapshot, options), /heartbeat/)
  for (const issue of [{ code: 'failed', count: -1 }, { code: 'failed', count: '37' }, { code: 'unknown', count: 1 }]) {
    const value = fixture()
    value.snapshot.copied_push_health.inherited_issues = [issue]
    assert.throws(() => pushReadiness(value.health, value.snapshot, options), /Invalid/)
  }
})
