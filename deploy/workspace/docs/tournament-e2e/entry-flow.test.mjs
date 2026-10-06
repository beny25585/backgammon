import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { browserEntryFlow, installEntryFlowObserver, safeEntryMilestone } from './entry-flow.mjs'

test('browser evidence is an explicit allowlist without tickets or arbitrary strings', () => {
  assert.deepEqual(safeEntryMilestone({ phase: 'entry_join_sent', browserAt: 100, tournamentId: 1,
    fixtureId: 2, attemptId: 'a'.repeat(32), seat: 'p1', ticket: 'secret', url: '?token=secret' }),
  { phase: 'entry_join_sent', browserAt: 100, tournamentId: 1, fixtureId: 2, attemptId: 'a'.repeat(32), seat: 'p1' })
  assert.equal(safeEntryMilestone({ phase: 'other', browserAt: 100, tournamentId: 1 }), null)
})

test('flow correlates the first attempt and keeps the intentional barrier separate', () => {
  const attemptId = 'a'.repeat(32)
  const event = (phase, browserAt, other = {}) => ({ label: 'p1', fixtureId: 2, phase, browserAt, attemptId, ...other })
  const summary = { matches: [{ fixtureId: 2, admission: { clicks: [{ label: 'p1', color: 'white', clickedAt: 1400 }] } }],
    observations: [{ kind: 'entry_button_prepared', fixtureId: 2, label: 'p1', preparedAt: 500 }],
    requests: [{ label: 'p1', startedAt: 1800, path: '/tournaments-api/gamelink/tournament/1/play/' }],
    entryFlowEvents: [event('playability_received', 200), event('entry_control_available', 300),
      event('entry_dom_click', 1450), event('entry_join_sent', 1460), event('waiting_received', 1500),
      event('pair_ready_received', 1700), event('ticket_request_sent', 1800), event('ticket_response_headers', 1850),
      event('ticket_response_json', 1860), event('entry_join_sent', 2000, { attemptId: 'b'.repeat(32) }),
      event('pair_ready_received', 2100, { attemptId: 'b'.repeat(32) })] }
  const before = structuredClone(summary)
  summary.entryFlowEvents.reverse() // Binding delivery order need not be timestamp order.
  const player = browserEntryFlow(summary).fixtures[0].players[0]
  assert.equal(player.phases.clickToJoinMs, 10)
  assert.equal(player.phases.joinToWaitingResponseMs, 40)
  assert.equal(player.phases.readyToTicketRequestMs, 100)
  assert.equal(player.phases.ticketHeadersMs, 50)
  assert.equal(player.phases.ticketJsonAfterHeadersMs, 10)
  assert.equal(player.phases.testBarrierMs, 900)
  assert.deepEqual(summary, { ...before, entryFlowEvents: [...before.entryFlowEvents].reverse() })
  assert.equal(browserEntryFlow({ matches: [{ fixtureId: 2, admission: { clicks: [{ color: 'white' }] } }] })
    .fixtures[0].players[0].phases.clickToJoinMs, null)
})

test('observer preserves messages and never manufactures readiness or network requests', async () => {
  let clock = 1000
  const received = []
  class Socket {
    listeners = new Map()
    sent = []
    send(value) { this.sent.push(value) }
    addEventListener(name, callback) { this.listeners.set(name, callback) }
    message(value) { this.listeners.get('message')?.({ data: JSON.stringify(value) }) }
  }
  class Response {
    constructor(payload, url = 'https://test.invalid/tournaments-api/tournaments') {
      this.payload = payload; this.url = url
      this.headers = { get: () => 'c'.repeat(32) }
    }
    async json() { return this.payload }
  }
  let domClick
  const control = { disabled: false, getAttribute: () => null, matches: () => true,
    getBoundingClientRect: () => ({ width: 100, height: 44 }) }
  const document = { addEventListener(_name, listener) { domClick = listener }, querySelectorAll: () => [control] }
  const ticketPayload = { enter_url: '?ticket=never-record-this' }
  const nativePromise = Promise.resolve(new Response(ticketPayload, 'https://test.invalid/tournaments-api/gamelink/tournament/1/play/'))
  let requests = 0
  const window = { WebSocket: Socket, location: { href: 'https://test.invalid/tournaments/' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    fetch() { requests++; return nativePromise } }
  await installEntryFlowObserver({
    async exposeBinding(name, callback) { window[name] = async event => callback({}, event) },
    async addInitScript(initializer, options) {
      vm.runInNewContext(`(${initializer.toString()})(options)`, { window, document, location: window.location,
        Response, URL, options, Date: { now: () => clock }, queueMicrotask,
        MutationObserver: class { observe() {} } })
    },
  }, { tourOrigin: 'https://test.invalid', onEvent: event => received.push(event) })
  window.__e2eEntryFlow.arm(1, 'Test')
  const payload = [{ id: 1, can_play: true, current_fixture_id: 2 }]
  const response = new Response(payload)
  assert.equal(await response.json(), payload)
  assert.equal(received.find(event => event.phase === 'playability_received').browserAt, 1000)
  assert.equal(received.filter(event => event.phase === 'entry_control_available').length, 1)
  clock = 1100
  domClick({ target: { closest: () => control } })
  assert.equal(received.find(event => event.phase === 'entry_dom_click').browserAt, 1100)
  assert.equal(requests, 0)
  const socket = new window.WebSocket('wss://test.invalid/tournaments-ws/club/updates/')
  const raw = JSON.stringify({ type: 'entry_join', tournament_id: 1, fixture_id: 2, attempt_id: 'a'.repeat(32) })
  socket.send(raw)
  clock = 1200
  const ready = { type: 'entry_state', attempt_id: 'a'.repeat(32), state: { fixture_id: 2, seat: 'p1', both_ready: true } }
  socket.message(ready)
  socket.message(ready)
  assert.equal(socket.sent[0], raw)
  assert.equal(socket.sent.length, 1)
  assert.equal(received.filter(event => event.phase === 'pair_ready_received').length, 1)
  assert.equal(received.find(event => event.phase === 'pair_ready_received').browserAt, 1200)
  clock = 1300
  assert.equal(window.fetch('/tournaments-api/gamelink/tournament/1/play/'), nativePromise)
  assert.equal(await (await nativePromise).json(), ticketPayload)
  assert.equal(requests, 1)
  assert.equal(received.find(event => event.phase === 'ticket_response_headers').serverTraceId, 'c'.repeat(32))
  assert.equal(received.filter(event => event.phase === 'ticket_response_json').length, 1)
  assert.equal(JSON.stringify(received).includes('never-record-this'), false)
})

test('an incomplete match retains entry evidence without manufacturing missing readiness', () => {
  const summary = { matches: [], entryFlowEvents: [{ label: 'player1', tournamentId: 1, fixtureId: 2,
    phase: 'entry_join_sent', browserAt: 1000, attemptId: 'a'.repeat(32) }] }
  const before = structuredClone(summary)
  const report = browserEntryFlow(summary)
  assert.equal(report.coverage.observedFixtures, 1)
  assert.equal(report.coverage.completedMatches, 0)
  assert.equal(report.coverage.completePlayers, 0)
  assert.equal(report.fixtures[0].completed, false)
  assert.equal(report.fixtures[0].players[0].milestones.joinSentAt, 1000)
  assert.equal(report.fixtures[0].players[0].milestones.pairReadyReceivedAt, null)
  assert.equal(report.fixtures[0].players[0].phases.testBarrierMs, null)
  assert.deepEqual(summary, before)
})
