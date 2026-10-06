import test from 'node:test'
import assert from 'node:assert/strict'
import { admissionDiagnostics } from './performance-report.mjs'
import { evaluatePerformance } from './performance-policy.mjs'

function summary() {
  const seat = (color, bothAt) => ({ color, socketConstructedAt: 1400, socketOpenedAt: 1500,
    initialStateAt: 1550, firstRoomStatusAt: 1560, firstBothConnectedAt: bothAt,
    document: { navigationStartedAt: 1100, responseStartedAt: 1200, responseEndedAt: 1300,
      resources: [{ path: '/backgammon/assets/main.js', durationMs: 50 }] } })
  return { matches: [{ fixtureId: 5, round: 0,
    admission: { elapsedMs: 400, clickedAt: 1300, clicks: [{ color: 'white', clickedAt: 1000 }, { color: 'black', clickedAt: 1300 }] },
    metrics: { admissionTiming: { observedAt: 1700, seats: [seat('white', 1600), seat('black', 1650)] } } }] }
}

test('pair evidence separates browser admission from driver detection and uses the later seat', () => {
  const diagnostic = admissionDiagnostics(summary()).fixtures[0]
  assert.equal(diagnostic.complete, true)
  assert.equal(diagnostic.nodeObservedAdmissionMs, 400)
  assert.equal(diagnostic.browserAdmissionMs, 350)
  assert.equal(diagnostic.driverDetectionLagMs, 50)
  assert.equal(diagnostic.seats[0].phases.clickToNavigationMs, 100)
  assert.equal(diagnostic.seats[0].phases.navigationToHtmlEndMs, 200)
  assert.equal(diagnostic.seats[0].phases.htmlTransferMs, 100)
  assert.equal(diagnostic.seats[0].phases.htmlEndToSocketConstructionMs, 100)
  assert.equal(diagnostic.seats[0].phases.socketOpenMs, 100)
  assert.equal(diagnostic.seats[0].phases.openToInitialStateMs, 50)
  assert.equal(diagnostic.seats[0].phases.openToBothConnectedMs, 100)
  // An old document started before this click; never invent a zero duration.
  assert.equal(diagnostic.seats[1].phases.clickToNavigationMs, null)
})

test('historical and partially missing evidence stays missing instead of reporting a fast entry', () => {
  const old = admissionDiagnostics({ matches: [{ fixtureId: 2, admission: { elapsedMs: 25000 } }] })
  assert.equal(old.coverage.completeDiagnostics, 0)
  assert.equal(old.fixtures[0].browserAdmissionMs, null)
  assert.equal(old.driverDetectionLag.count, 0)
  const partial = summary()
  partial.matches[0].metrics.admissionTiming.seats[1].firstBothConnectedAt = null
  assert.equal(admissionDiagnostics(partial).fixtures[0].complete, false)
  assert.equal(admissionDiagnostics(partial).fixtures[0].browserAdmissionMs, null)
})

test('diagnostics leave the original performance acceptance and its measurements intact', () => {
  const input = summary()
  const scenario = { matches: 1, players: 2, rounds: 1, recoveryChecks: false }
  input.matches[0].admission.elapsedMs = 25000
  input.matches[0].resultConfirmationMs = 1000
  input.matches[0].metrics.seats = ['white', 'black'].map(color => ({ color, acknowledged: 1, totalAckMs: 100, maxAckMs: 100 }))
  const before = structuredClone(input)
  const acceptance = evaluatePerformance(input, scenario)
  admissionDiagnostics(input)
  assert.deepEqual(input, before)
  assert.deepEqual(evaluatePerformance(input, scenario), acceptance)
  assert.equal(acceptance.passed, false)
  assert.equal(acceptance.violations[0].metric, 'admission')
  assert.equal(acceptance.violations[0].limitMs, 15000)
})
