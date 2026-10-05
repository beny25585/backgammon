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
    if (context?.purpose !== 'browser-e2e'
      || context.databases?.game !== `backgammon_game_e2e_${suffix}`
      || context.databases?.tournaments !== `backgammon_tournaments_e2e_${suffix}`
      || context.redis_databases?.game !== 8 || context.redis_databases?.tournaments !== 9) {
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
