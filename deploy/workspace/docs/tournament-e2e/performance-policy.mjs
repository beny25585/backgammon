// Initial acceptance budgets, not a measured production capacity guarantee.
export const performancePolicy = Object.freeze({
  version: 1, maxRoundMeanAckMs: 1000, maxActionAckMs: 5000,
  maxAdmissionMs: 15000, maxResultConfirmationMs: 15000,
})

export function evaluatePerformance(summary, scenario) {
  const violations = []
  const check = (metric, value, limitMs, details = {}) => {
    if (!Number.isFinite(value) || value < 0) {
      violations.push({ metric, reason: 'missing_or_invalid_measurement', ...details })
    } else if (value > limitMs) violations.push({ metric, valueMs: value, limitMs, ...details })
  }
  const matches = summary.matches || []
  if (matches.length !== scenario.matches
    || new Set(matches.map(match => match.fixtureId)).size !== scenario.matches) {
    violations.push({ metric: 'coverage', reason: 'incomplete_matches', expected: scenario.matches, actual: matches.length })
  }
  const delayed = matches.filter(match => match.admission?.excludedReason)
  if (delayed.length > (scenario.recoveryChecks ? 1 : 0)
    || delayed.some(match => match.round !== 0 || match.admission.excludedReason !== 'intentional_recovery_delay')) {
    violations.push({ metric: 'admission', reason: 'unexpected_exclusion' })
  }
  for (const match of matches) {
    const details = { fixtureId: match.fixtureId, round: match.round }
    if (!match.admission?.excludedReason) check('admission', match.admission?.elapsedMs, performancePolicy.maxAdmissionMs, details)
    check('result_confirmation', match.resultConfirmationMs, performancePolicy.maxResultConfirmationMs, details)
    const seats = match.metrics?.seats || []
    if (seats.length !== 2 || seats.some(seat => !Number.isInteger(seat.acknowledged) || seat.acknowledged <= 0
      || !Number.isFinite(seat.totalAckMs) || seat.totalAckMs < 0)) {
      violations.push({ metric: 'action_ack', reason: 'missing_seat_samples', ...details })
    }
    for (const seat of seats) check('action_ack', seat.maxAckMs, performancePolicy.maxActionAckMs, { ...details, color: seat.color })
  }
  for (let round = 0; round < scenario.rounds; round++) {
    const roundMatches = matches.filter(match => match.round === round)
    const expected = scenario.players / 2 ** (round + 1)
    if (roundMatches.length !== expected) violations.push({ metric: 'round_coverage', round, expected, actual: roundMatches.length })
    const seats = roundMatches.flatMap(match => match.metrics?.seats || [])
    const count = seats.reduce((sum, seat) => sum + seat.acknowledged, 0)
    const mean = count > 0 ? seats.reduce((sum, seat) => sum + seat.totalAckMs, 0) / count : null
    check('round_mean_ack', mean, performancePolicy.maxRoundMeanAckMs, { round, samples: count })
  }
  return { passed: violations.length === 0, policy: performancePolicy, violations,
    excludedAdmissions: delayed.map(match => ({ fixtureId: match.fixtureId, reason: match.admission.excludedReason })),
    timingScope: 'Browser-observed latency. Confirmation includes up to one second of shared observer sampling. Intentional recovery admission delay is excluded; its gameplay and result remain gated.' }
}
