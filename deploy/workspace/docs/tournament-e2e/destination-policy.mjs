import { isDeepStrictEqual } from 'node:util'

/** Permit a remote target only when it is the explicitly prepared rehearsal. */
export function runtimeOrigins(runtime) {
  const remote = runtime.profile === 'server-rehearsal'
  const expected = 'https://38.247.146.17.nip.io:18443'
  const validation = runtime.remote_target?.validation_id
  const candidate = validation !== undefined
  if (candidate && (!/^[a-f0-9]{32}$/.test(validation)
    || !/^[a-f0-9]{40}$/.test(runtime.remote_target?.infrastructure_revision || ''))) {
    throw new Error('Invalid release validation identity.')
  }
  const project = candidate ? `backgammon-candidate-${validation}` : 'backgammon-rehearsal-20261005t184922z'
  if (remote && (runtime.remote_target?.origin !== expected
    || runtime.remote_target?.project !== project
    || !/^[a-f0-9]{32}$/.test(runtime.remote_target?.session_id || '')
    || runtime.database_mode !== 'postgresql')) {
    throw new Error('Remote browser runs require the prepared PostgreSQL rehearsal identity.')
  }
  if (remote) {
    const context = runtime.remote_target.database_context
    const suffix = runtime.remote_target.session_id.slice(0, 12)
    const copied = context?.purpose === 'copied-browser-e2e'
    const integrations = Object.hasOwn(runtime.remote_target, 'integrations')
    if (integrations ? !isDeepStrictEqual(runtime.remote_target.integrations,
      { analysis: true, push: true, ai: true, google: true })
      || !isDeepStrictEqual(runtime.remote_target.integration_context,
        { analysis_database: copied ? context.databases?.analysis : `backgammon_analysis_e2e_${suffix}`,
          analysis_url: 'http://analysis-api:8000', push_key_scope: copied ? 'candidate-load' : 'browser-e2e' })
      : Object.hasOwn(runtime.remote_target, 'integration_context')) {
      throw new Error('Remote browser runs require the complete isolated integration context.')
    }
    const expectedContext = { purpose: 'browser-e2e',
      databases: { game: `backgammon_game_e2e_${suffix}`, tournaments: `backgammon_tournaments_e2e_${suffix}` },
      redis_databases: integrations ? { game: 10, tournaments: 11 } : { game: 8, tournaments: 9 } }
    if (copied) {
      if (!candidate || runtime.remote_target.load_cleanup_version !== 1 || !integrations
        || !/^[a-f0-9]{40}$/.test(runtime.remote_target.tools_revision || '')
        || !isDeepStrictEqual(Object.keys(context).sort(), ['databases', 'markers', 'purpose', 'redis_databases'])
        || !isDeepStrictEqual(Object.keys(context.databases || {}).sort(), ['analysis', 'game', 'tournaments'])
        || !isDeepStrictEqual(Object.keys(context.markers || {}).sort(), ['analysis', 'game', 'tournaments'])
        || !isDeepStrictEqual(Object.keys(context.redis_databases || {}).sort(), ['game', 'tournaments'])) {
        throw new Error('Copied load requires a prepared candidate and scoped cleanup.')
      }
      for (const [kind, name] of Object.entries(context.databases)) {
        const restored = new RegExp(`^bgv_restore_${validation.slice(0, 12)}_[a-z0-9_]{1,22}$`).test(name)
        if (restored ? context.markers[kind] !== `backgammon-validation:${validation}:restore:${name}`
          : name !== `backgammon_${kind}` || context.markers[kind] !== null) {
          throw new Error('Unexpected copied candidate database or restoration marker.')
        }
      }
      const indexes = Object.values(context.redis_databases)
      if (indexes.some(value => !Number.isInteger(value) || value < 0 || value > 15) || new Set(indexes).size !== 2) {
        throw new Error('Invalid copied candidate Redis database.')
      }
    } else if (!isDeepStrictEqual(context, expectedContext)) {
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
