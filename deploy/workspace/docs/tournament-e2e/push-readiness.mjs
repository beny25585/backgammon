const queueCodes = new Set(['failed', 'retrying', 'delayed'])

export function pushReadiness(health, snapshot, { copied, runId, sessionId }) {
  if (!Array.isArray(health?.issues) || !health.last_worker_seen_at) {
    throw new Error('Push health response or worker heartbeat is missing.')
  }
  if (!copied) return { issues: health.issues, globalIssues: health.issues, inheritedIssues: [] }
  const scoped = snapshot?.copied_push_health
  if (snapshot?.kind !== 'tournaments' || snapshot.session_id !== sessionId
    || scoped?.run_id !== runId || scoped.target_session !== sessionId
    || !Array.isArray(scoped.new_issues) || !Array.isArray(scoped.inherited_issues)) {
    throw new Error('Copied Push health requires the current run baseline and service identity.')
  }
  for (const issue of [...scoped.new_issues, ...scoped.inherited_issues]) {
    if (!queueCodes.has(issue?.code) || !Number.isSafeInteger(issue.count) || issue.count <= 0) {
      throw new Error('Invalid copied Push queue evidence.')
    }
  }
  const worker = snapshot.push
  if (!worker?.last_seen_at || !worker.expected_by
    || !(Date.parse(worker.expected_by) > Date.parse(snapshot.observed_at))) {
    throw new Error('Copied Push worker heartbeat is not current.')
  }
  return {
    issues: [...health.issues.filter(issue => !queueCodes.has(issue?.code)), ...scoped.new_issues],
    globalIssues: health.issues, inheritedIssues: scoped.inherited_issues,
  }
}
