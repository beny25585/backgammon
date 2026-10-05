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
