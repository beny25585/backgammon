import test from 'node:test'
import assert from 'node:assert/strict'
import { validateControl } from './remote-load-control.mjs'
import { runtimeOrigins } from './destination-policy.mjs'

function manifest() {
  const root = '/home/dev/backgammon-project'
  const validation = 'b'.repeat(32)
  const tag = 'backgammon-production-candidate-20261007-r7'
  const project = `${root}/deploy/backgammon-deploy/${tag}`
  const rehearsal = `${root}/backups/backgammon-backups/validation-${validation}/docker-rehearsal`
  return { identity: { validation_id: validation, infrastructure_revision: 'c'.repeat(40), image_tag: tag,
    tools_revision: 'd'.repeat(40),
    project: `backgammon-candidate-${validation}`, origin: 'https://38.247.146.17.nip.io:18443', session_id: 'a'.repeat(32),
    load_cleanup_version: 1, integrations: { analysis: true, push: true, ai: true, google: true },
    integration_context: { analysis_database: 'backgammon_analysis', analysis_url: 'http://analysis-api:8000', push_key_scope: 'candidate-load' },
    database_context: { purpose: 'copied-browser-e2e', databases: { game: 'backgammon_game', tournaments: 'backgammon_tournaments', analysis: 'backgammon_analysis' },
      markers: { game: null, tournaments: null, analysis: null }, redis_databases: { game: 0, tournaments: 1 } } },
    load_control: { destination: 'administrator@38.247.146.17', project, rehearsal,
      tools: `${root}/sources/backgammon/deploy/workspace/docs/tournament-e2e` } }
}

test('copied load requires exact managed server paths and a pinned validation', () => {
  const value = manifest()
  assert.equal(validateControl(value), value.load_control)
  for (const change of [{ destination: 'administrator@other-server' }, { project: '/home/dev/production' },
    { tools: '/tmp/tools' }, { rehearsal: '/tmp/other-copy' }]) {
    assert.throws(() => validateControl({ ...value, load_control: { ...value.load_control, ...change } }))
  }
})

test('copied databases are permitted only with scoped cleanup on the candidate test port', () => {
  const value = manifest()
  const runtime = { profile: 'server-rehearsal', database_mode: 'postgresql', remote_target: value.identity,
    urls: { game: value.identity.origin, tournament: value.identity.origin } }
  assert.deepEqual([...runtimeOrigins(runtime)], [value.identity.origin])
  for (const change of [{ load_cleanup_version: 0 }, { project: 'backgammon-production' },
    { origin: 'https://38.247.146.17.nip.io' }, { validation_id: 'd'.repeat(32) }]) {
    assert.throws(() => runtimeOrigins({ ...runtime, remote_target: { ...value.identity, ...change } }))
  }
  const context = structuredClone(value.identity.database_context)
  context.databases.game = 'bgv_restore_' + 'b'.repeat(12) + '_0_abc123'
  context.markers.game = `backgammon-validation:${'d'.repeat(32)}:restore:${context.databases.game}`
  assert.throws(() => runtimeOrigins({ ...runtime, remote_target: { ...value.identity, database_context: context } }))
})
