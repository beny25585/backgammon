import test from 'node:test'
import assert from 'node:assert/strict'
import { runtimeOrigins } from './destination-policy.mjs'

const remote = () => ({ profile: 'server-rehearsal', database_mode: 'postgresql',
  remote_target: { origin: 'https://38.247.146.17.nip.io:18443',
    project: 'backgammon-rehearsal-20261005t184922z', session_id: 'a'.repeat(32) },
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
