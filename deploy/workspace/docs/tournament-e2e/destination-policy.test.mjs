import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeOrigins } from './destination-policy.mjs'

const remote = () => ({ profile: 'server-rehearsal', database_mode: 'postgresql',
  remote_target: { origin: 'https://38.247.146.17.nip.io:18443',
    project: 'backgammon-rehearsal-20261005t184922z', session_id: 'a'.repeat(32),
    database_context: { purpose: 'browser-e2e',
      databases: { game: 'backgammon_game_e2e_' + 'a'.repeat(12), tournaments: 'backgammon_tournaments_e2e_' + 'a'.repeat(12) },
      redis_databases: { game: 8, tournaments: 9 } } },
  urls: { game: 'https://38.247.146.17.nip.io:18443', tournament: 'https://38.247.146.17.nip.io:18443' } })

const comprehensive = () => {
  const runtime = remote()
  runtime.remote_target.integrations = { analysis: true, push: true, ai: true, google: true }
  runtime.remote_target.integration_context = {
    analysis_database: 'backgammon_analysis_e2e_' + 'a'.repeat(12),
    analysis_url: 'http://analysis-api:8000', push_key_scope: 'browser-e2e' }
  runtime.remote_target.database_context.redis_databases = { game: 10, tournaments: 11 }
  return runtime
}

test('a configured rehearsal cannot send its second service to production', () => {
  const runtime = remote()
  runtime.urls.game = 'https://38.247.146.17.nip.io'
  assert.throws(() => runtimeOrigins(runtime), /Invalid isolated/)
})
test('a public origin without the copied-project identity is refused', () => {
  const runtime = remote()
  runtime.remote_target.project = 'backgammon-production'
  assert.throws(() => runtimeOrigins(runtime), /prepared PostgreSQL/)
})
test('local mode cannot opt into a public endpoint by changing its URLs', () => {
  const runtime = remote()
  runtime.profile = 'local'
  assert.throws(() => runtimeOrigins(runtime), /Invalid isolated/)
})
test('the test listener and loopback profiles keep their exact origins', () => {
  assert.deepEqual([...runtimeOrigins(remote())], ['https://38.247.146.17.nip.io:18443'])
  assert.deepEqual([...runtimeOrigins({ urls: { game: 'https://127.0.0.1:18805', tournament: 'https://localhost:18806' } })],
    ['https://127.0.0.1:18805', 'https://localhost:18806'])
})

test('a copied database cannot be used for the fresh browser load scenario', () => {
  const runtime = remote()
  runtime.remote_target.database_context.databases.game = 'backgammon_game'
  assert.throws(() => runtimeOrigins(runtime), /fresh browser database/)
})

test('a manifest from before fresh provisioning is refused', () => {
  const runtime = remote()
  delete runtime.remote_target.database_context
  assert.throws(() => runtimeOrigins(runtime), /fresh browser database/)
})

test('a different database session or the previous Redis context is refused', () => {
  const runtime = remote()
  runtime.remote_target.database_context.databases.tournaments = 'backgammon_tournaments_e2e_' + 'b'.repeat(12)
  assert.throws(() => runtimeOrigins(runtime), /fresh browser database/)
  const oldRedis = remote()
  oldRedis.remote_target.database_context.redis_databases.game = 0
  assert.throws(() => runtimeOrigins(oldRedis), /fresh browser database/)
})

test('the complete integration rehearsal accepts its separately provisioned Redis databases', () => {
  assert.deepEqual([...runtimeOrigins(comprehensive())], ['https://38.247.146.17.nip.io:18443'])
})

test('Redis contexts cannot be mixed between the base and integration rehearsals', () => {
  for (const [create, redis] of [[remote, { game: 10, tournaments: 11 }],
    [comprehensive, { game: 8, tournaments: 9 }], [comprehensive, { game: 10, tournaments: 9 }]]) {
    const runtime = create()
    runtime.remote_target.database_context.redis_databases = redis
    assert.throws(() => runtimeOrigins(runtime), /fresh browser database/)
  }
})

test('partial or undeclared integration activation is refused', () => {
  for (const name of ['analysis', 'push', 'ai', 'google']) {
    const runtime = comprehensive()
    runtime.remote_target.integrations[name] = false
    assert.throws(() => runtimeOrigins(runtime), /isolated integration context/)
  }
  const missing = comprehensive()
  delete missing.remote_target.integrations
  assert.throws(() => runtimeOrigins(missing), /isolated integration context/)
  const extra = comprehensive()
  extra.remote_target.integrations.email = true
  assert.throws(() => runtimeOrigins(extra), /isolated integration context/)
})

test('analysis must use the same fresh session, internal URL and test Push scope', () => {
  for (const [key, value] of [['analysis_database', 'backgammon_analysis'],
    ['analysis_database', 'backgammon_analysis_e2e_' + 'b'.repeat(12)],
    ['analysis_url', 'https://analysis.example.com'], ['push_key_scope', 'production']]) {
    const runtime = comprehensive()
    runtime.remote_target.integration_context[key] = value
    assert.throws(() => runtimeOrigins(runtime), /isolated integration context/)
  }
  const missing = comprehensive()
  delete missing.remote_target.integration_context
  assert.throws(() => runtimeOrigins(missing), /isolated integration context/)
})

test('comprehensive mode retains the production-origin and database guards', () => {
  const production = comprehensive()
  production.urls.tournament = 'https://38.247.146.17.nip.io'
  assert.throws(() => runtimeOrigins(production), /Invalid isolated/)
  const copied = comprehensive()
  copied.remote_target.database_context.databases.game = 'backgammon_game'
  assert.throws(() => runtimeOrigins(copied), /fresh browser database/)
})
