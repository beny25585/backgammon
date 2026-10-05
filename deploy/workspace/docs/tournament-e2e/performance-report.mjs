import fs from 'node:fs'
import path from 'node:path'
import { scenarioConfig } from './scenario-config.mjs'
import { evaluatePerformance } from './performance-policy.mjs'

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return { count: 0 }
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
  return { count: sorted.length, meanMs: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) }
}

export function writePerformanceReport(runDir) {
  const read = name => fs.existsSync(path.join(runDir, name)) ? fs.readFileSync(path.join(runDir, name), 'utf8') : ''
  const summary = JSON.parse(read('tournament-summary.json') || '{}')
  const game = JSON.parse(read('status-game.json') || '{}')
  const runtime = JSON.parse(read('config.json') || '{}')
  const scenario = scenarioConfig(runtime)
  // Backend samples are logged above a threshold. Never describe their means
  // as the latency distribution of every action.
  const samples = {}
  const databaseWorkers = new Set()
  const delivery = { scope: 'Observed log entries; DEBUG sampling may omit successful deliveries.',
    snapshots: 0, statusFailures: 0, statusCompletedTasks: 0,
    statusTasks: (game.tasks || []).filter(task => task.name === 'game.link.live.deliver_status_event') }
  for (const file of ['logs/game.log', 'logs/tournament.log']) {
    for (const line of read(file).split('\n')) {
      const fields = Object.fromEntries([...line.matchAll(/\b([a-z_]+)=([\w.:-]+)/g)].map(m => [m[1], m[2]]))
      if (line.includes('GAME_WS_DB_EXECUTORS ')) databaseWorkers.add(Number(fields.workers))
      if (['db_call_slow', 'sqlite_transaction_slow', 'sqlite_writer_held'].includes(fields.event)) {
        const operation = `${file}:${fields.event}:${fields.operation || 'transaction'}`
        for (const metric of ['total_ms', 'queue_ms', 'execution_ms', 'sql_ms', 'duration_ms', 'commit_ms', 'work_ms']) {
          if (fields[metric] !== undefined) (samples[`${operation}:${metric}`] ??= []).push(Number(fields[metric]))
        }
      }
      if (line.includes('SLOW_GAME_ACTION ')) {
        for (const metric of ['total_ms', 'persist_ms', 'broadcast_ms', 'timeout_reschedule_ms', 'game_over_callback_ms']) {
          if (fields[metric] !== undefined) (samples[`${file}:slow_action:${fields.action}:${metric}`] ??= []).push(Number(fields[metric]))
        }
      }
      if (line.includes('event=snapshot_delivered')) delivery.snapshots++
      if (line.includes('event=snapshot_delivery_failed')) delivery.statusFailures++
      if (line.includes('TASK_DONE') && line.includes('name=game.link.live.deliver_status_event')) delivery.statusCompletedTasks++
    }
  }
  const seats = (summary.matches || []).flatMap(match => match.metrics?.seats || [])
  const acknowledged = seats.reduce((sum, seat) => sum + seat.acknowledged, 0)
  const completed = new Set((summary.matches || []).map(match => match.fixtureId))
  const lastObserved = new Map()
  for (const observation of summary.observations || []) {
    if (observation.kind === 'game_driver' && !completed.has(observation.fixtureId)) {
      lastObserved.set(observation.fixtureId, observation.games || [])
    }
  }
  const unfinishedSeats = [...lastObserved.values()].flatMap(games => games.map(game => game.metrics).filter(Boolean))
  const unfinishedAcknowledged = unfinishedSeats.reduce((sum, seat) => sum + seat.acknowledged, 0)
  const report = {
    acceptance: evaluatePerformance(summary, scenario),
    scope: runtime.profile === 'server-rehearsal'
      ? 'Browser load from this PC through public host Nginx HTTPS to R2 server images and fresh browser PostgreSQL databases. ACK timings include this network connection. Server log samples are not collected by this browser runner.'
      : 'This machine and isolated databases; no production capacity guarantee. Slow DB log samples are threshold-selected.',
    playerCount: scenario.players, recoveryChecks: scenario.recoveryChecks,
    websocketDatabaseWorkersObserved: [...databaseWorkers].filter(Number.isFinite),
    acknowledgedActions: acknowledged,
    weightedMeanAckMs: acknowledged ? Math.round(seats.reduce((sum, seat) => sum + seat.totalAckMs, 0) / acknowledged) : null,
    maxAckMs: seats.length ? Math.max(...seats.map(seat => seat.maxAckMs)) : null,
    unfinishedMatches: {
      scope: 'Last recorded observations of unfinished/failed matches; separate from completed-match metrics.',
      matches: lastObserved.size, acknowledgedActions: unfinishedAcknowledged,
      weightedMeanAckMs: unfinishedAcknowledged ? Math.round(unfinishedSeats.reduce((sum, seat) => sum + seat.totalAckMs, 0) / unfinishedAcknowledged) : null,
      maxAckMs: unfinishedSeats.length ? Math.max(...unfinishedSeats.map(seat => seat.maxAckMs)) : null,
    },
    rounds: Array.from({ length: scenario.rounds }, (_, round) => {
      const roundSeats = (summary.matches || []).filter(match => match.round === round).flatMap(match => match.metrics?.seats || [])
      const count = roundSeats.reduce((sum, seat) => sum + seat.acknowledged, 0)
      return { round, acknowledged: count, meanAckMs: count ? Math.round(roundSeats.reduce((sum, seat) => sum + seat.totalAckMs, 0) / count) : null,
        maxAckMs: roundSeats.length ? Math.max(...roundSeats.map(seat => seat.maxAckMs)) : null }
    }),
    clockTimeoutResults: (game.linked_rooms || []).flatMap(room => room.matches || [])
      .filter(match => match.end_reason === 'time').length,
    browserCompletedClockTimeouts: (summary.matches || []).filter(match => match.result?.reason === 'time').length,
    clockEvidence: 'Natural completion is checked by the scenario. No clock compensation or disabled product deadline is applied. Queue timing alone cannot prove whether an individual timeout was fair.',
    selectedSlowSamples: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, distribution(values)])),
    delivery,
    analysis503: (summary.excludedIntegrationErrors || []).filter(error => error.status === 503).length,
  }
  fs.writeFileSync(path.join(runDir, 'performance-summary.json'), JSON.stringify(report, null, 2))
  return report
}
