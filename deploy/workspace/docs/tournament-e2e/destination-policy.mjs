import { isDeepStrictEqual } from 'node:util'

/** Permit a remote target only when it is the explicitly prepared rehearsal. */
export function runtimeOrigins(runtime) {
  const remote = runtime.profile === 'server-rehearsal'
  const expected = 'https://38.247.146.17.nip.io:18443'
  if (remote && (runtime.remote_target?.origin !== expected
    || runtime.remote_target?.project !== 'backgammon-rehearsal-20261005t184922z'
    || !/^[a-f0-9]{32}$/.test(runtime.remote_target?.session_id || '')
    || runtime.database_mode !== 'postgresql')) {
    throw new Error('Remote browser runs require the prepared PostgreSQL rehearsal identity.')
  }
  if (remote) {
    const context = runtime.remote_target.database_context
    const suffix = runtime.remote_target.session_id.slice(0, 12)
    const integrations = Object.hasOwn(runtime.remote_target, 'integrations')
    if (integrations ? !isDeepStrictEqual(runtime.remote_target.integrations,
      { analysis: true, push: true, ai: true, google: true })
      || !isDeepStrictEqual(runtime.remote_target.integration_context,
        { analysis_database: `backgammon_analysis_e2e_${suffix}`,
          analysis_url: 'http://analysis-api:8000', push_key_scope: 'browser-e2e' })
      : Object.hasOwn(runtime.remote_target, 'integration_context')) {
      throw new Error('Remote browser runs require the complete isolated integration context.')
    }
    const expectedContext = { purpose: 'browser-e2e',
      databases: { game: `backgammon_game_e2e_${suffix}`, tournaments: `backgammon_tournaments_e2e_${suffix}` },
      redis_databases: integrations ? { game: 10, tournaments: 11 } : { game: 8, tournaments: 9 } }
    if (!isDeepStrictEqual(context, expectedContext)) {
      throw new Error('Remote browser runs require the fresh browser database context.')
    }
  }
  return new Set(['game', 'tournament'].map(key => {
    const url = new URL(runtime.urls[key])
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || (remote ? url.origin !== expected
        : !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
      throw new Error(`Invalid isolated HTTPS origin: ${key}`)
    }
    return url.origin
  }))
}
