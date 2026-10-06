/** Passive browser milestones; never sends requests or changes entry decisions. */
export function safeEntryMilestone(event) {
  const phases = ['playability_received', 'entry_control_available', 'entry_dom_click',
    'entry_join_sent', 'entry_join_resent', 'waiting_received', 'pair_ready_received',
    'ticket_request_sent', 'ticket_response_headers', 'ticket_response_json']
  if (!event || !phases.includes(event.phase) || !Number.isFinite(event.browserAt) ||
    !Number.isSafeInteger(event.tournamentId) || event.tournamentId < 1) return null
  const safe = { phase: event.phase, browserAt: event.browserAt, tournamentId: event.tournamentId }
  if (Number.isSafeInteger(event.fixtureId) && event.fixtureId > 0) safe.fixtureId = event.fixtureId
  if (/^[a-f0-9]{32}$/.test(event.attemptId ?? '')) safe.attemptId = event.attemptId
  if (['p1', 'p2'].includes(event.seat)) safe.seat = event.seat
  if (/^[a-f0-9]{32}$/.test(event.serverTraceId ?? '')) safe.serverTraceId = event.serverTraceId
  return safe
}

export async function installEntryFlowObserver(context, { tourOrigin, onEvent }) {
  await context.exposeBinding('__e2eEntryMilestone', (_source, event) => {
    const safe = safeEntryMilestone(event)
    if (safe) onEvent(safe)
  })
  await context.addInitScript(({ origin }) => {
    if (window.__e2eEntryFlow) return
    let target = null
    let preparedFixture = null
    const available = new Set()
    const received = new Set()
    const snapshots = new Map()
    const seenClicks = new Set()
    const attempts = new Map()
    const now = () => Date.now()
    const positive = value => Number.isSafeInteger(value) && value > 0
    const token = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
    function emit(phase, details = {}) {
      if (!target) return
      void window.__e2eEntryMilestone({ phase, browserAt: now(), tournamentId: target.tournamentId,
        ...details }).catch(() => {})
    }
    function visible(element) {
      if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    function entryControl(element) {
      if (!element || !target) return false
      return element.matches('[data-testid="quick-match-button"]') ||
        (element.closest('[role="dialog"]') && element.textContent.includes(target.name))
    }
    function checkControl() {
      if (!target || !positive(target.fixtureId) || !received.has(target.fixtureId) || available.has(target.fixtureId)) return
      const control = [...document.querySelectorAll('button')].find(element => entryControl(element) && visible(element))
      if (control) {
        available.add(target.fixtureId)
        emit('entry_control_available', { fixtureId: target.fixtureId })
      }
    }
    function snapshot(payload) {
      if (!payload) return
      const rows = Array.isArray(payload) ? payload : [payload.tournament ?? payload]
      for (const row of rows) {
        if (positive(Number(row?.id)) && row.can_play === true && positive(row.current_fixture_id)) {
          if (snapshots.get(Number(row.id))?.fixtureId !== row.current_fixture_id) {
            if (snapshots.size >= 64) snapshots.delete(snapshots.keys().next().value)
            snapshots.set(Number(row.id), { fixtureId: row.current_fixture_id, at: now() })
          }
        }
      }
      if (!target) return
      const tournament = rows.find(row => Number(row?.id) === target.tournamentId && row.can_play === true)
      const fixtureId = tournament?.current_fixture_id ?? payload.fixture?.id
      if (!tournament || !positive(fixtureId)) return
      target.fixtureId = fixtureId
      if (!received.has(fixtureId)) {
        received.add(fixtureId)
        emit('playability_received', { fixtureId })
      }
      queueMicrotask(checkControl)
    }
    const originalJson = Response.prototype.json
    function ticketPath(url) {
      return url.origin === origin && /\/tournaments-api\/gamelink\/tournament\/\d+\/play\/$/.test(url.pathname)
    }
    const originalFetch = window.fetch
    if (originalFetch) window.fetch = function (...args) {
      const promise = originalFetch.apply(this, args)
      let selected = false
      try { selected = target && ticketPath(new URL(args[0]?.url ?? String(args[0]), location.href)) } catch { /* Native fetch decides validity. */ }
      if (selected) {
        const fixtureId = preparedFixture ?? target.fixtureId
        emit('ticket_request_sent', { fixtureId })
        void promise.then(response => {
          const serverTraceId = response.headers.get('x-e2e-trace-id')
          emit('ticket_response_headers', { fixtureId, serverTraceId })
        }).catch(() => {})
      }
      return promise
    }
    Response.prototype.json = async function (...args) {
      const payload = await originalJson.apply(this, args)
      try {
        const url = new URL(this.url)
        if (target && ticketPath(url)) emit('ticket_response_json', { fixtureId: preparedFixture ?? target.fixtureId,
          serverTraceId: this.headers.get('x-e2e-trace-id') })
        if (url.origin === origin && url.pathname.startsWith('/tournaments-api/') &&
          !/\/(?:auth|gamelink)\//.test(url.pathname)) snapshot(payload)
      } catch { /* A synthetic response has no URL. */ }
      return payload
    }
    document.addEventListener('click', event => {
      const control = event.target?.closest?.('button')
      const fixtureId = preparedFixture ?? target?.fixtureId
      if (!entryControl(control) || !positive(fixtureId) || seenClicks.has(fixtureId)) return
      seenClicks.add(fixtureId)
      emit('entry_dom_click', { fixtureId })
    }, true)
    const mutation = new MutationObserver(checkControl)
    mutation.observe(document, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'class', 'style', 'hidden'] })
    const NativeSocket = window.WebSocket
    window.WebSocket = new Proxy(NativeSocket, {
      construct(Target, args, NewTarget) {
        const socket = Reflect.construct(Target, args, NewTarget)
        let club = false
        try { club = new URL(String(args[0]), location.href).pathname === '/tournaments-ws/club/updates/' } catch { /* Invalid native URL. */ }
        if (!club) return socket
        const originalSend = socket.send
        socket.send = function (data) {
          let message
          try { message = JSON.parse(String(data)) } catch { /* Not an entry message. */ }
          const sent = originalSend.call(this, data)
          if (target && message?.type === 'entry_join' && message.tournament_id === target.tournamentId && token(message.attempt_id)) {
            const fixtureId = positive(message.fixture_id) ? message.fixture_id : preparedFixture ?? target.fixtureId
            const attempt = attempts.get(message.attempt_id) ?? { fixtureId, waiting: false, ready: false }
            if (!attempts.has(message.attempt_id)) {
              if (attempts.size >= 64) attempts.delete(attempts.keys().next().value)
              attempts.set(message.attempt_id, attempt)
              emit('entry_join_sent', { fixtureId, attemptId: message.attempt_id })
            } else emit('entry_join_resent', { fixtureId, attemptId: message.attempt_id })
          }
          return sent
        }
        socket.addEventListener('message', event => {
          let message
          try { message = JSON.parse(event.data) } catch { return }
          if (message?.type !== 'entry_state' || !token(message.attempt_id)) return
          const attempt = attempts.get(message.attempt_id)
          const state = message.state
          if (!attempt || !positive(state?.fixture_id) || !['p1', 'p2'].includes(state.seat)) return
          const ready = state.both_ready === true
          const key = ready ? 'ready' : 'waiting'
          if (attempt[key]) return
          attempt[key] = true
          emit(ready ? 'pair_ready_received' : 'waiting_received', { fixtureId: state.fixture_id,
            attemptId: message.attempt_id, seat: state.seat })
        })
        return socket
      },
    })
    window.__e2eEntryFlow = {
      arm(tournamentId, name, fixtureId = null) {
        if (!positive(tournamentId) || typeof name !== 'string') return
        target = { tournamentId, name, fixtureId: positive(fixtureId) ? fixtureId : null }
        preparedFixture = positive(fixtureId) ? fixtureId : null
        const saved = snapshots.get(tournamentId)
        if (saved && (!preparedFixture || preparedFixture === saved.fixtureId)) {
          target.fixtureId = saved.fixtureId
          if (!received.has(saved.fixtureId)) {
            received.add(saved.fixtureId)
            emit('playability_received', { fixtureId: saved.fixtureId, browserAt: saved.at })
          }
        }
        checkControl()
      },
    }
  }, { origin: tourOrigin })
}

export function browserEntryFlow(summary) {
  const elapsed = (end, start) => Number.isFinite(end) && Number.isFinite(start) && end >= start ? end - start : null
  const events = [...(summary.entryFlowEvents ?? [])].sort((a, b) => a.browserAt - b.browserAt)
  const observed = new Map((summary.matches ?? []).map(match => [match.fixtureId,
    { ...match, completed: true, admission: { ...match.admission, clicks: [...(match.admission?.clicks ?? [])] } }]))
  for (const event of events) {
    if (!Number.isSafeInteger(event.fixtureId) || typeof event.label !== 'string') continue
    if (!observed.has(event.fixtureId)) observed.set(event.fixtureId, { fixtureId: event.fixtureId,
      completed: false, admission: { clicks: [] } })
    const match = observed.get(event.fixtureId)
    if (!match.admission.clicks.some(click => click.label === event.label)) {
      const clicked = (summary.observations ?? []).find(row => row.kind === 'entry_click_command_completed' &&
        row.fixtureId === event.fixtureId && row.label === event.label)
      match.admission.clicks.push({ label: event.label, color: null, clickedAt: clicked?.clickedAt ?? null })
    }
  }
  const fixtures = [...observed.values()].map(match => ({ fixtureId: match.fixtureId, completed: match.completed,
      players: (match.admission?.clicks ?? []).map(click => {
        const rows = events.filter(event => event.fixtureId === match.fixtureId && event.label === click.label)
        const first = phase => rows.find(event => event.phase === phase)?.browserAt ?? null
        const attempts = rows.filter(event => event.phase === 'entry_join_sent')
        const attemptId = attempts[0]?.attemptId ?? null
        const scoped = phase => rows.find(event => event.phase === phase && event.attemptId === attemptId)?.browserAt ?? null
        const prepared = (summary.observations ?? []).find(event => event.kind === 'entry_button_prepared' &&
          event.fixtureId === match.fixtureId && event.label === click.label)
        const readyAt = scoped('pair_ready_received')
        const ticket = (summary.requests ?? []).find(request => request.label === click.label && Number.isFinite(request.startedAt) &&
          request.startedAt >= (readyAt ?? Infinity) && /\/gamelink\/tournament\/\d+\/play\/$/.test(request.path))
        return { label: click.label ?? null, color: click.color, attemptId, milestones: {
          playabilityReceivedAt: first('playability_received'), controlAvailableAt: first('entry_control_available'),
          domClickAt: first('entry_dom_click'), joinSentAt: scoped('entry_join_sent'),
          waitingReceivedAt: scoped('waiting_received'), pairReadyReceivedAt: readyAt,
          ticketRequestStartedAt: first('ticket_request_sent'), ticketResponseHeadersAt: first('ticket_response_headers'),
          ticketResponseJsonAt: first('ticket_response_json'), nodeTicketRequestStartedAt: ticket?.startedAt ?? null,
        }, phases: {
          dataToControlMs: elapsed(first('entry_control_available'), first('playability_received')),
          clickToJoinMs: elapsed(scoped('entry_join_sent'), first('entry_dom_click')),
          joinToWaitingResponseMs: elapsed(scoped('waiting_received'), scoped('entry_join_sent')),
          joinToPairReadyMs: elapsed(readyAt, scoped('entry_join_sent')),
          readyToTicketRequestMs: elapsed(first('ticket_request_sent'), readyAt),
          ticketHeadersMs: elapsed(first('ticket_response_headers'), first('ticket_request_sent')),
          ticketJsonAfterHeadersMs: elapsed(first('ticket_response_json'), first('ticket_response_headers')),
          testBarrierMs: elapsed(click.clickedAt, prepared?.preparedAt),
        }, joinTransmissions: rows.filter(event => ['entry_join_sent', 'entry_join_resent'].includes(event.phase)).length }
      }),
    }))
  const players = fixtures.flatMap(fixture => fixture.players)
  const milestones = ['playabilityReceivedAt', 'controlAvailableAt', 'domClickAt', 'joinSentAt',
    'pairReadyReceivedAt', 'ticketRequestStartedAt', 'ticketResponseHeadersAt', 'ticketResponseJsonAt']
  return { version: 1, clock: 'browser PC only',
    limitations: ['Availability is DOM visibility observed after real API JSON, not a pixel paint timestamp.',
      'Waiting for the opponent and the intentional test barrier are separate from processing.',
      'Browser and server clocks must not be subtracted. Missing phases remain null.'],
    coverage: { observedFixtures: fixtures.length, completedMatches: (summary.matches ?? []).length,
      players: players.length, completePlayers: players.filter(player =>
      milestones.every(name => Number.isFinite(player.milestones[name]))).length,
      missing: players.map(player => ({ label: player.label, attemptId: player.attemptId,
        milestones: milestones.filter(name => !Number.isFinite(player.milestones[name])) })).filter(row => row.milestones.length) },
    fixtures }
}
