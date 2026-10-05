import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluatePerformance } from './performance-policy.mjs'
import { scenarioConfig } from './scenario-config.mjs'

const scenario = scenarioConfig({ player_count: 16, recovery_checks: false })
function complete() {
  let fixtureId = 0
  return { matches: Array.from({ length: scenario.rounds }, (_, round) =>
    Array.from({ length: scenario.players / 2 ** (round + 1) }, () => ({
      fixtureId: ++fixtureId, round, admission: { elapsedMs: 1000 }, resultConfirmationMs: 1000,
      metrics: { seats: ['white', 'black'].map(color => ({ color, acknowledged: 10, totalAckMs: 5000, maxAckMs: 800 })) },
    }))).flat() }
}
test('complete fast measurements pass; absent admission evidence fails closed', () => {
  const summary = complete()
  assert.equal(evaluatePerformance(summary, scenario).passed, true)
  delete summary.matches[0].admission
  assert.equal(evaluatePerformance(summary, scenario).passed, false)
})
test('a slow burst round fails even when later rounds make the overall mean acceptable', () => {
  const summary = complete()
  for (const match of summary.matches.filter(match => match.round === 0)) {
    for (const seat of match.metrics.seats) seat.totalAckMs = 10010
  }
  assert.ok(evaluatePerformance(summary, scenario).violations.some(item => item.metric === 'round_mean_ack' && item.round === 0))
})
test('one slow action and delayed result each fail independently', () => {
  const summary = complete()
  summary.matches[0].metrics.seats[0].maxAckMs = 5001
  summary.matches[1].resultConfirmationMs = 15001
  const metrics = evaluatePerformance(summary, scenario).violations.map(item => item.metric)
  assert.ok(metrics.includes('action_ack'))
  assert.ok(metrics.includes('result_confirmation'))
})
test('only one intentional first-round recovery admission can be excluded', () => {
  const summary = complete()
  summary.matches[0].admission = { elapsedMs: 22000, excludedReason: 'intentional_recovery_delay' }
  assert.equal(evaluatePerformance(summary, { ...scenario, recoveryChecks: true }).passed, true)
  assert.equal(evaluatePerformance(summary, scenario).passed, false)
  summary.matches[1].admission = summary.matches[0].admission
  assert.equal(evaluatePerformance(summary, { ...scenario, recoveryChecks: true }).passed, false)
})
test('partial or duplicate fixture evidence can never produce a pass', () => {
  const summary = complete()
  summary.matches[1].fixtureId = summary.matches[0].fixtureId
  assert.equal(evaluatePerformance(summary, scenario).passed, false)
  summary.matches.pop()
  assert.equal(evaluatePerformance(summary, scenario).passed, false)
})
