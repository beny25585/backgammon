import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { installGameObserver, waitForGame, inspectGame, driveMatch } from './game-driver.mjs'
import { createEventJournal } from './event-journal.mjs'
import { scenarioConfig } from './scenario-config.mjs'
import { createSharedProgress } from './shared-progress.mjs'
import { runtimeOrigins } from './destination-policy.mjs'

const runDir = process.env.E2E_RUN_DIR
if (!runDir || !path.isAbsolute(runDir)) throw new Error('E2E_RUN_DIR is required.')
const runtime = JSON.parse(fs.readFileSync(path.join(runDir, 'config.json'), 'utf8'))
const scenario = scenarioConfig(runtime)
if (![true, 1, '1'].includes(runtime.E2E_DISPOSABLE)
  || path.resolve(runtime.run_dir) !== path.resolve(runDir)) throw new Error('Disposable runtime required.')
const require = createRequire(path.join(process.env.E2E_GAME_FRONTEND || path.join(runtime.workspace, 'Backgammon Game/frontend'), 'package.json'))
const { test, expect } = require('@playwright/test')
const tourOrigin = new URL(runtime.urls.tournament).origin
const gameOrigin = new URL(runtime.urls.game).origin
const origins = runtimeOrigins(runtime)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fixturesOf = (progress) => Object.values(progress.stages).flatMap(
  (stage) => stage.levels.flatMap((level) => level.fixtures),
)
const safePath = (value) => {
  try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return '[invalid URL]' }
}
const secrets = [runtime.admin.password]
function redact(value) {
  let text = String(value ?? '')
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]')
  return text.replace(/(?:https?|wss?):\/\/[^\s"'<>]+/g, safePath)
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT redacted]')
    .replace(/((?:token|ticket|password|authorization)[=:]\s*)[^\s&,;]+/gi, '$1[redacted]')
    .slice(0, 1600)
}

test(`${scenario.players} players enter together and complete a real knockout`, async ({ browser }, testInfo) => {
  const started = Date.now()
  const summary = {
    runId: runtime.run_id, startedAt: new Date().toISOString(), status: 'running',
    playerCount: scenario.players, recoveryChecks: scenario.recoveryChecks,
    targetSession: runtime.remote_target?.session_id ?? null,
    scope: runtime.profile === 'server-rehearsal'
      ? 'Prepared server rehearsal through host Nginx HTTPS; browser load from this PC; fresh browser PostgreSQL databases.'
      : 'Disposable local HTTPS; signup/login/registration/admission through UI; legal gameplay over the UI real WebSocket.',
    adminSetup: 'Seeded administrator; tournament creation and scheduled start use authenticated APIs, not admin UI.',
    browserInstrumentation: { headless: process.env.E2E_HEADED !== '1',
      channel: process.env.CHROMIUM_PATH ? 'custom_chromium' : process.env.E2E_BROWSER || 'chrome',
      requestRouting: 'all_requests_origin_guard',
      httpCache: 'disabled_by_playwright_routing', serviceWorkers: 'blocked',
      admissionTiming: 'Browser callback timestamps are diagnostic; the existing Node-observed acceptance metric is unchanged.' },
    dice: 'Real configured dice service; no board/result/score injection.',
    limits: ['Desktop Chromium, not physical mobile.', `${scenario.players} accounts from one machine and network connection.`,
      'Gameplay drives legal protocol intents through the UI socket; it does not validate pointer/drag controls.',
      'Only GET /tournaments-api/analyses HTTP 503 is classified separately when analysis is explicitly disabled; responses are not mocked.',
      runtime.profile === 'server-rehearsal'
        ? `Final acceptance requires a separate server audit and ${scenario.matches * 2} unchanged signed result replays.`
        : `Wallet award is checked across normal workers; the orchestrator then repeats all ${scenario.matches} unchanged signed results twice and verifies the final database.`],
    observations: [], matches: [], requests: [], failedRequests: [], serverErrors: [], excludedIntegrationErrors: [],
    console: [], pageErrors: [], blockedExternal: [], frontendRequests: [],
    earlySemifinalObserved: false,
  }
  const contexts = []
  const requestStarts = new WeakMap()
  const firstReadyRequests = new Map()
  const admissions = new Map()
  const eventsFile = path.join(runDir, 'browser-events.ndjson')
  const summaryFile = path.join(runDir, 'tournament-summary.json')
  const journal = createEventJournal(eventsFile)
  const observe = (kind, details = {}) => {
    const event = { at: new Date().toISOString(), elapsedMs: Date.now() - started, kind, ...details }
    summary.observations.push(event)
    journal.append(event)
  }
  const record = (bucket, event) => {
    const timestamped = { at: new Date().toISOString(), ...event }
    // Bound memory during a failing poll loop, but retain the entire safe stream on disk.
    if (summary[bucket].length < 10_000) summary[bucket].push(timestamped)
    journal.append({ bucket, ...timestamped })
  }
  const recordServerError = (event) => {
    if (event.status < 500) return
    const excludedAnalysis = runtime.excluded_integrations?.includes('analysis')
      && event.status === 503 && event.method === 'GET'
      && new URL(event.path).pathname === '/tournaments-api/analyses'
    record(excludedAnalysis ? 'excludedIntegrationErrors' : 'serverErrors', event)
  }
  const isGameFrontendRequest = (request) => {
    const url = new URL(request.url())
    return url.origin === gameOrigin && url.pathname.startsWith('/backgammon/')
      && ['document', 'script', 'stylesheet', 'font'].includes(request.resourceType())
  }
  async function newUser(label) {
    const context = await browser.newContext({ ignoreHTTPSErrors: runtime.profile !== 'server-rehearsal', locale: 'en-US',
      viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
    contexts.push(context)
    await context.addInitScript(() => {
      try { localStorage.setItem('backgammon-tournaments-locale', 'en') } catch { /* Opaque initial document. */ }
    })
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (origins.has(url.origin)) return route.continue()
      record('blockedExternal', { label, path: safePath(url.href) })
      return route.abort('blockedbyclient')
    })
    await context.routeWebSocket((url) => !origins.has(url.origin.replace(/^ws/, 'http')), (socket) => {
      record('blockedExternal', { label, path: safePath(socket.url()) })
      socket.close()
    })
    await installGameObserver(context)
    context.on('request', (request) => {
      const now = Date.now()
      requestStarts.set(request, now)
      if (request.method() === 'POST'
        && new URL(request.url()).pathname === `/tournaments-api/gamelink/tournament/${tournamentId}/ready/`
        && !firstReadyRequests.has(label)) firstReadyRequests.set(label, now)
    })
    context.on('requestfailed', (request) => record('failedRequests', {
      label, method: request.method(), path: safePath(request.url()),
      startedAt: requestStarts.get(request) ?? null,
      elapsedMs: Date.now() - (requestStarts.get(request) ?? Date.now()),
      error: redact(request.failure()?.errorText),
    }))
    context.on('response', (response) => {
      const event = { label, method: response.request().method(), path: safePath(response.url()),
        startedAt: requestStarts.get(response.request()) ?? null,
        status: response.status(), elapsedMs: Date.now() - (requestStarts.get(response.request()) ?? Date.now()) }
      if (event.path.includes('/tournaments-api/') || event.path.includes('/api/link/')) record('requests', event)
      if (isGameFrontendRequest(response.request())) {
        record('frontendRequests', { ...event, resourceType: response.request().resourceType(), phase: 'response_headers' })
      }
      recordServerError(event)
    })
    context.on('requestfinished', (request) => {
      if (isGameFrontendRequest(request)) {
        record('frontendRequests', { label, method: request.method(), path: safePath(request.url()),
          resourceType: request.resourceType(), phase: 'body_finished',
          startedAt: requestStarts.get(request) ?? null,
          elapsedMs: Date.now() - (requestStarts.get(request) ?? Date.now()) })
      }
    })
    context.on('page', (page) => {
      page.on('websocket', (socket) => {
        if (new URL(socket.url()).pathname !== '/tournaments-ws/club/updates/') return
        socket.on('framesent', ({ payload }) => {
          let message
          try { message = JSON.parse(String(payload)) } catch { return }
          if (message.type === 'entry_join' && message.tournament_id === tournamentId
            && !firstReadyRequests.has(label)) firstReadyRequests.set(label, Date.now())
        })
      })
      page.on('console', (message) => {
        if (['error', 'warning'].includes(message.type())) record('console', {
          label, level: message.type(), message: redact(message.text()), path: safePath(page.url()),
        })
      })
      page.on('pageerror', (error) => record('pageErrors', { label, error: redact(error.message), path: safePath(page.url()) }))
    })
    return { label, context, page: await context.newPage() }
  }
  async function api(user, endpoint, { method = 'GET', data, allowedStatuses = [] } = {}) {
    const cookies = await user.context.cookies(tourOrigin)
    const csrf = cookies.find((cookie) => cookie.name === 'csrftoken')?.value
    const begin = Date.now()
    let response
    try {
      response = await user.context.request.fetch(`${tourOrigin}/tournaments-api${endpoint}`, {
        method, ...(data === undefined ? {} : { data }), timeout: 0, maxRedirects: 0,
        headers: { Accept: 'application/json', Origin: tourOrigin, Referer: `${tourOrigin}/tournaments/`,
          ...(csrf ? { 'X-CSRFToken': csrf } : {}) },
      })
    } catch (error) {
      record('failedRequests', { label: user.label, source: 'assertion-api', method,
        startedAt: begin,
        path: `${tourOrigin}/tournaments-api${endpoint.split('?')[0]}`,
        elapsedMs: Date.now() - begin, error: redact(error.message) })
      throw error
    }
    const event = { label: user.label, source: 'assertion-api', method,
      startedAt: begin,
      path: safePath(response.url()), status: response.status(), elapsedMs: Date.now() - begin }
    record('requests', event)
    recordServerError(event)
    if (!response.ok() && !allowedStatuses.includes(response.status())) {
      throw new Error(`API ${method} ${endpoint.split('?')[0]} returned HTTP ${response.status()}`)
    }
    return response.json()
  }
  let admin
  let tournamentId
  const players = new Map()
  let tournamentStartedAt
  const progress = createSharedProgress(() => api(admin, `/admin/tournaments/${tournamentId}/progress`))
  const current = (player) => api(player, `/tournaments/${tournamentId}/current-match`)
  async function waitFixture(id, predicate, message) {
    let found
    await expect.poll(async () => {
      found = fixturesOf(await progress()).find((fixture) => fixture.id === id)
      return Boolean(found && predicate(found))
    }, { message, timeout: 0, intervals: [250] }).toBe(true)
    return found
  }
  async function entryButton(player, fixtureId, gate) {
    await player.page.goto(`${tourOrigin}/tournaments/tournaments/${tournamentId}`)
    const own = await current(player)
    expect(own.fixture?.id, `${player.label} personal fixture`).toBe(fixtureId)
    expect(own.fixture.can_play, `${player.label} can play own fixture`).toBe(true)
    // Detail pages can show an automatic picker as well as the shared banner.
    const picker = player.page.getByRole('dialog').filter({ hasText: summary.tournamentName })
    const quick = player.page.getByTestId('quick-match-button').filter({ visible: true }).first()
    await expect.poll(async () => (await picker.isVisible().catch(() => false))
      || await quick.isVisible().catch(() => false), { timeout: 0 }).toBe(true)
    const button = await picker.isVisible().catch(() => false)
      ? picker.getByRole('button').filter({ hasText: summary.tournamentName }) : quick
    // Prepare every real control before releasing any first-round click.
    await button.click({ trial: true })
    if (gate) await gate.arrive(player.label)
    const clickedAt = Date.now()
    await button.click()
    observe('entry_click_command_completed', { label: player.label, fixtureId, clickedAt,
      elapsedMs: Date.now() - clickedAt })
    return clickedAt
  }
  function admissionGate(count) {
    const ready = new Set()
    let release
    let timer
    const released = new Promise((resolve, reject) => {
      release = resolve
      // Admission waits until every real player control is ready or the user stops the run.
    })
    // A setup error can abort before every participant reaches the barrier.
    released.catch(() => {})
    return {
      async arrive(label) {
        expect(ready.has(label), 'Each account reaches the entry barrier once').toBe(false)
        ready.add(label)
        if (ready.size === count) {
          clearTimeout(timer)
          observe('concurrent_entry_released', { players: [...ready], count })
          release()
        }
        await released
      },
      close() { clearTimeout(timer) },
    }
  }
  async function enterFixture(fixture, { delayedSecond = false, gate } = {}) {
    const first = players.get(fixture.player1.user_id)
    const second = players.get(fixture.player2.user_id)
    expect(first, 'fixture first account exists').toBeTruthy()
    expect(second, 'fixture second account exists').toBeTruthy()
    const evidence = { fixtureId: fixture.id, delayedSecond }
    const readyPath = `/tournaments-api/gamelink/tournament/${tournamentId}/ready/`
    const playPath = `/tournaments-api/gamelink/tournament/${tournamentId}/play/`
    let delayedReady = false
    let delayedPlay = false
    if (delayedSecond) {
      // Delay an authentic server frame, preserving payload and live upstream.
      // Legacy HTTP readiness below remains supported for older candidates.
      await second.page.routeWebSocket('**/tournaments-ws/club/updates/', (socket) => {
        const server = socket.connectToServer()
        let forwarding = Promise.resolve()
        server.onMessage((message) => {
          forwarding = forwarding.then(async () => {
            let data
            try { data = JSON.parse(String(message)) } catch { /* Forward unchanged. */ }
            if (!delayedReady && data?.type === 'entry_state' && data.state?.both_ready) {
              delayedReady = true
              evidence.secondReadyAt = Date.now()
              await delay(10_000)
            }
            socket.send(message)
          }).catch(error => record('pageErrors', { label: second.label, error: redact(error.message) }))
        })
      })
      await second.page.route(`**${readyPath}`, async (route) => {
        const response = await route.fetch({ timeout: 0 })
        const data = await response.json()
        if (!delayedReady && data.both_ready) {
          delayedReady = true
          evidence.secondReadyAt = Date.now()
          // Each delay remains below the application's own ready/play timeout.
          await delay(10_000)
        }
        await route.fulfill({ response })
      })
      await second.page.route(`**${playPath}`, async (route) => {
        if (!delayedPlay) { delayedPlay = true; await delay(12_000) }
        evidence.secondTicketRequestedAt = Date.now()
        await route.continue()
      })
    }
    // No synthetic ready calls or tickets: the first round releases all UI
    // clicks together; later pairs also click concurrently once prepared.
    const clickTimes = await Promise.all([
      entryButton(first, fixture.id, gate), entryButton(second, fixture.id, gate),
    ])
    await waitForGame(first.page, { timeoutMs: Infinity })
    evidence.firstRoomAt = Date.now()
    if (delayedSecond) {
      let waiting
      await expect.poll(async () => {
        waiting = await current(first)
        return waiting.fixture?.operational_status
      }, { timeout: 0, intervals: [250, 500, 1000], message: 'First-seat admission remains waiting before second redemption' }).toBe('waiting')
      expect(waiting.fixture?.id).toBe(fixture.id)
      expect(waiting.fixture?.is_confirmed).toBe(false)
      const firstGame = await inspectGame(first.page)
      evidence.firstRoomId = firstGame.roomId
      expect(firstGame.roomId).toBeTruthy()
      if (waiting.fixture.external_room_id) expect(waiting.fixture.external_room_id).toBe(firstGame.roomId)
      evidence.firstRoomPhase = firstGame.state?.phase
      evidence.firstLiveStatus = waiting.fixture.live?.status ?? null
      expect(waiting.fixture.live?.status).not.toBe('playing')
      expect(['waiting', 'opening_roll', 'opening_result']).toContain(evidence.firstRoomPhase)
      expect(firstGame.connectedColors).not.toContain(firstGame.color === 'white' ? 'black' : 'white')
    }
    await waitForGame(second.page, { timeoutMs: Infinity })
    const [one, two] = await Promise.all([inspectGame(first.page), inspectGame(second.page)])
    expect(one.roomId).toBe(two.roomId)
    expect(new Set([one.color, two.color]).size).toBe(2)
    evidence.roomId = one.roomId
    // Start when both users have clicked, excluding ordinary opponent wait.
    admissions.set(fixture.id, { clickedAt: Math.max(...clickTimes), observedAt: Date.now(),
      clicks: clickTimes.map((clickedAt, index) => ({ color: [one, two][index].color, clickedAt })),
      ...(delayedSecond ? { excludedReason: 'intentional_recovery_delay' } : {}) })
    evidence.firstRoundEntryElapsedMs = fixture.round_index === 0 ? Date.now() - tournamentStartedAt : null
    if (fixture.round_index === 0) expect(evidence.firstRoundEntryElapsedMs).toBeLessThan(10 * 60_000)
    if (delayedSecond) {
      expect(delayedReady && delayedPlay).toBe(true)
      evidence.secondReadinessAgeAtTicketMs = evidence.secondTicketRequestedAt - evidence.secondReadyAt
      expect(evidence.secondReadinessAgeAtTicketMs).toBeGreaterThan(15_000)
      expect(evidence.firstRoomAt).toBeLessThan(evidence.secondTicketRequestedAt)
      await second.page.unroute(`**${readyPath}`)
      await second.page.unroute(`**${playPath}`)
    }
    observe('fixture_entered', evidence)
    return [first, second]
  }
  async function finishFixture(fixture, entered, initialGames) {
    const pair = entered ?? await enterFixture(fixture)
    const seats = await Promise.all(pair.map((player) => inspectGame(player.page)))
    // Fresh TournamentLink rows default p1 to white; p2 receives the opposite
    // color. Keep the account-to-seat proof separate from the score callback.
    expect(seats.map((seat) => seat.color)).toEqual(['white', 'black'])
    const result = await driveMatch(pair.map((player) => player.page), {
      allowedOrigins: [...origins],
      timeoutMs: Infinity,
      actionTimeoutMs: Infinity,
      initialGames,
      onObservation: (event) => observe('game_driver', { fixtureId: fixture.id, ...event }),
    })
    const done = await waitFixture(fixture.id, (item) => item.is_confirmed, 'Real result callback confirms fixture')
    const resultConfirmationMs = Date.now() - result.endedAt
    expect(done.admin_resolution).toBeFalsy()
    expect(done.score1 !== null && done.score2 !== null).toBe(true)
    expect(done.winner_id).toBeTruthy()
    expect(done.external_room_id, 'Result callback belongs to the room actually played').toBe(result.roomId)
    expect(done.player1.id).toBe(fixture.player1.id)
    expect(done.player2.id).toBe(fixture.player2.id)
    const scoresByColor = { white: result.result.whiteScore, black: result.result.blackScore }
    expect(done.score1, 'Fixture p1 score matches its observed game color').toBe(scoresByColor[seats[0].color])
    expect(done.score2, 'Fixture p2 score matches its observed game color').toBe(scoresByColor[seats[1].color])
    const winningSeat = seats.findIndex((seat) => seat.color === result.winnerColor)
    expect(winningSeat).toBeGreaterThanOrEqual(0)
    expect(done.winner_id, 'The actual winning account advances in the bracket')
      .toBe(winningSeat === 0 ? fixture.player1.id : fixture.player2.id)
    const item = { fixtureId: done.id, round: done.round_index, roomId: done.external_room_id,
      score1: done.score1, score2: done.score2, winnerId: done.winner_id,
      moves: result.moves, rolls: result.rolls, winnerColor: result.winnerColor, metrics: result.metrics,
      admission: { elapsedMs: result.metrics.firstBothConnectedAt - admissions.get(fixture.id)?.clickedAt,
        clickedAt: admissions.get(fixture.id)?.clickedAt, clicks: admissions.get(fixture.id)?.clicks,
        ...(admissions.get(fixture.id)?.excludedReason ? { excludedReason: admissions.get(fixture.id).excludedReason } : {}) },
      resultConfirmationMs,
      result: result.result, terminalMove: result.terminalMove }
    summary.matches.push(item)
    observe('fixture_completed', item)
    return done
  }
  try {
    admin = await newUser('admin')
    await api(admin, '/csrf/')
    await api(admin, '/auth/login', { method: 'POST', data: runtime.admin })
    const suffix = String(runtime.run_id).replace(/[^a-z0-9]/gi, '').slice(-12)
    const password = `E2E!${randomBytes(16).toString('hex')}z9`
    const phonePrefix = randomBytes(3).readUIntBE(0, 3).toString().padStart(5, '0').slice(-5)
    secrets.push(password)
    for (let index = 0; index < scenario.players; index++) {
      const player = await newUser(`player${index + 1}`)
      const username = `E2E${suffix}P${index + 1}`
      await player.page.goto(`${tourOrigin}/tournaments/account/signup`)
      await player.page.locator('input[autocomplete="username"]').fill(username)
      await player.page.locator('input[type="email"]').fill(`${username.toLowerCase()}@example.invalid`)
      await player.page.locator('input[type="tel"]').fill(`+97250${phonePrefix}${String(index).padStart(2, '0')}`)
      await player.page.locator('#account-password').fill(password)
      const signup = player.page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/auth/signup'))
      await player.page.locator('form button[type="submit"]').click()
      expect((await signup).status()).toBe(201)
      await expect(player.page).toHaveURL(/\/tournaments\/(?:home|tournaments)(?:[/?#]|$)/)
      const identity = await api(player, '/auth/me')
      player.id = identity.id
      player.username = identity.username
      player.initialBalance = Number(identity.balance)
      await api(player, '/auth/logout', { method: 'POST', data: {} })
      await player.page.goto(`${tourOrigin}/tournaments/login`)
      await player.page.getByTestId('login-username').fill(identity.username)
      await player.page.locator('#login-password').fill(password)
      await player.page.locator('form button[type="submit"]').click()
      await expect(player.page).toHaveURL(/\/tournaments\/(?:home|tournaments)(?:[/?#]|$)/)
      expect((await api(player, '/auth/me')).id).toBe(identity.id)
      players.set(identity.id, player)
    }
    expect(players.size).toBe(scenario.players)
    summary.tournamentName = `Disposable E2E ${suffix}`
    const startsAt = new Date(Date.now() + 120_000)
    const tournament = await api(admin, '/admin/tournaments', { method: 'POST', data: {
      name: summary.tournamentName, template: 'knockout', starts_at: startsAt.toISOString(),
      min_players: scenario.players, max_players: scenario.players, target_points: 1, time_control: 'normal', doubling_enabled: false,
      entry_fee: '0.00', prize_money: '100.00', prize_type: 'coins', open_registration: true,
    } })
    tournamentId = tournament.id
    summary.tournamentId = tournamentId
    expect(tournament.state).toBe('open')
    // Registration uses real Vue buttons, with all accounts prepared concurrently.
    await Promise.all([...players.values()].map(async (player) => {
      await player.page.goto(`${tourOrigin}/tournaments/tournaments/${tournamentId}`)
      const joined = player.page.waitForResponse((response) => response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith(`/tournaments/${tournamentId}/join`))
      await player.page.getByRole('button', { name: 'Confirm registration and join', exact: true }).click()
      const response = await joined
      expect(response.status()).toBe(200)
      expect((await response.json()).is_joined).toBe(true)
    }))
    expect((await api(admin, `/admin/tournaments/${tournamentId}`)).participant_count).toBe(scenario.players)
    await expect.poll(async () => {
      const state = (await api(admin, `/admin/tournaments/${tournamentId}`)).state
      if (state === 'open' && Date.now() >= startsAt.getTime()) {
        // Use the normal start API when the product's scheduled time is due.
        // A competing scheduler may already have started it and return 412.
        await api(admin, `/admin/tournaments/${tournamentId}/start`, {
          method: 'POST', data: {}, allowedStatuses: [412],
        })
        return (await api(admin, `/admin/tournaments/${tournamentId}`)).state
      }
      if (!['open', 'active'].includes(state)) throw new Error(`Tournament became ${state} before admission`)
      return state
    }, { timeout: 0, intervals: [250, 500], message: 'Scheduled tournament start becomes active' }).toBe('active')
    // A scheduled start is no later than actual fixture creation, so this is a
    // conservative bound for the unchanged ten-minute first-round entry window.
    tournamentStartedAt = startsAt.getTime()
    observe('tournament_active', { tournamentId, scheduledStart: startsAt.toISOString() })
    const initial = await progress()
    const fixtures = fixturesOf(initial)
    expect(fixtures).toHaveLength(scenario.matches)
    const firstRound = fixtures.filter((item) => item.round_index === 0)
    expect(firstRound).toHaveLength(scenario.firstRoundGames)
    const gate = admissionGate(scenario.players)
    const firstRoundJobs = new Map(firstRound.map((fixture, index) => [fixture.id, (async () => {
      const pair = await enterFixture(fixture, { gate, delayedSecond: scenario.recoveryChecks && index === 0 })
      // Drive each pair immediately. Others must not sit idle while the delayed
      // player is admitting or while another room is being refreshed.
      let initialProof
      if (scenario.recoveryChecks && index === 0) {
        initialProof = await Promise.all(pair.map((player) => inspectGame(player.page)))
        const beforeReload = initialProof[0]
        await pair[0].page.reload()
        await waitForGame(pair[0].page, { timeoutMs: Infinity, roomId: beforeReload.roomId })
        await entryButton(pair[0], fixture.id)
        await waitForGame(pair[0].page, { timeoutMs: Infinity, roomId: beforeReload.roomId })
        expect((await inspectGame(pair[0].page)).color).toBe(beforeReload.color)
        observe('same_room_reentry', { fixtureId: fixture.id, roomId: beforeReload.roomId })
      }
      return finishFixture(fixture, pair, initialProof)
    })()]))
    const jobs = new Map(firstRoundJobs)
    function completeBranch(fixture) {
      if (jobs.has(fixture.id)) return jobs.get(fixture.id)
      const job = (async () => {
        const feeders = fixtures.filter((item) => item.bracket?.winner_to?.fixture_id === fixture.id)
        expect(feeders).toHaveLength(2)
        await Promise.all(feeders.map(completeBranch))
        const next = await waitFixture(fixture.id,
          (item) => Boolean(item.player1 && item.player2), 'Next-round pair propagates')
        const snapshot = fixturesOf(await progress())
        const unresolved = snapshot.filter((item) => item.round_index < next.round_index && !item.is_confirmed)
        if (unresolved.length) {
          expect(snapshot.find((item) => item.id === fixture.id).is_current_round).toBe(false)
          summary.earlyRoundObserved = true
          if (next.round_index === scenario.semifinalRound) summary.earlySemifinalObserved = true
          observe('early_round_available', { fixtureId: fixture.id, round: next.round_index,
            unresolvedFixtureIds: unresolved.map((item) => item.id) })
        }
        for (const seat of [next.player1, next.player2]) {
          const own = await current(players.get(seat.user_id))
          expect(own.fixture.id).toBe(fixture.id)
          expect(own.fixture.can_play).toBe(true)
          expect(own.tournament.current_fixture_id).toBe(fixture.id)
        }
        return finishFixture(next)
      })()
      jobs.set(fixture.id, job)
      return job
    }
    const finals = fixtures.filter((item) => item.round_index === scenario.finalRound)
    expect(finals).toHaveLength(1)
    let completedFinal
    try {
      completedFinal = await completeBranch(finals[0])
    } finally { gate.close() }
    const readyTimes = [...players.values()].map((player) => {
      const requestedAt = firstReadyRequests.get(player.label)
      expect(requestedAt, `${player.label} sent its real readiness intent over HTTP or WebSocket`).toBeTruthy()
      return { player: player.label, requestedAt }
    })
    const spreadMs = Math.max(...readyTimes.map((item) => item.requestedAt))
      - Math.min(...readyTimes.map((item) => item.requestedAt))
    expect(spreadMs, 'All first entry requests must be concurrent, not sequential setup').toBeLessThanOrEqual(5000)
    summary.concurrentAdmission = { players: scenario.players, spreadMs, requests: readyTimes }
    observe('concurrent_first_round_admission_verified', summary.concurrentAdmission)
    if (!summary.earlySemifinalObserved) observe('early_semifinal_not_observed', {
      reason: 'Earlier rounds completed before semifinal admission; this run does not prove early-round access.',
    })
    let finalProgress
    await expect.poll(async () => {
      finalProgress = await progress()
      return finalProgress.is_finished
    }, { timeout: 0, intervals: [250] }).toBe(true)
    const completed = fixturesOf(finalProgress)
    expect(completed).toHaveLength(scenario.matches)
    expect(completed.every((item) => item.is_confirmed && item.admin_resolution === '')).toBe(true)
    expect(summary.matches).toHaveLength(scenario.matches)
    expect(new Set(summary.matches.map((item) => item.roomId)).size).toBe(scenario.matches)
    expect(finalProgress.podium).toHaveLength(2)
    expect(finalProgress.podium[0].id).toBe(completedFinal.winner_id)
    expect(finalProgress.tournament.champion.id).toBe(completedFinal.winner_id)
    const winnerSeat = [completedFinal.player1, completedFinal.player2].find((seat) => seat.id === completedFinal.winner_id)
    const winner = players.get(winnerSeat.user_id)
    const walletEndpoint = `/admin/wallet-transactions?tournament_id=${tournamentId}&kind=tournament_prize`
    let wallet
    await expect.poll(async () => { wallet = await api(admin, walletEndpoint); return wallet.count }, {
      timeout: 0, intervals: [250],
    }).toBe(1)
    expect(wallet.items[0].user_id).toBe(winner.id)
    expect(Number(wallet.items[0].amount)).toBe(100)
    expect(Number((await api(winner, '/auth/me')).balance)).toBe(winner.initialBalance + 100)
    const awardId = wallet.items[0].id
    for (let check = 0; check < 3; check++) {
      await progress()
      wallet = await api(admin, walletEndpoint)
      expect(wallet.count).toBe(1)
      expect(wallet.items[0].id).toBe(awardId)
    }
    await winner.page.goto(`${tourOrigin}/tournaments/tournaments/${tournamentId}`)
    await expect(winner.page.getByText(winnerSeat.name, { exact: true }).filter({ visible: true }).first()).toBeVisible()
    summary.final = { fixtures: completed.map((item) => ({ id: item.id, round: item.round_index,
      score1: item.score1, score2: item.score2, winnerId: item.winner_id, roomId: item.external_room_id })),
      championId: completedFinal.winner_id, podium: finalProgress.podium, awardId, awardAmount: 100 }
    expect(summary.serverErrors, 'No browser/assertion API HTTP 5xx').toHaveLength(0)
    expect(summary.pageErrors, 'No unhandled browser errors').toHaveLength(0)
    summary.status = 'passed'
  } catch (error) {
    summary.status = 'failed'
    summary.error = { name: error.name, message: redact(error.message), stack: redact(error.stack) }
    throw new Error(summary.error.message)
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()))
    summary.journal = await journal.close()
    if (summary.journal.error) {
      summary.scenarioStatus = summary.status
      summary.status = 'failed'
      summary.error ??= { name: 'EventJournalError', message: redact(summary.journal.error.message) }
    }
    summary.finishedAt = new Date().toISOString()
    summary.elapsedMs = Date.now() - started
    summary.counts = { accounts: players.size, completedMatches: summary.matches.length,
      requestFailures: summary.failedRequests.length, server5xx: summary.serverErrors.length,
      excludedIntegrationErrors: summary.excludedIntegrationErrors.length,
      pageErrors: summary.pageErrors.length }
    fs.writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
    await testInfo.attach('tournament-summary', { path: summaryFile, contentType: 'application/json' })
    if (fs.existsSync(eventsFile)) await testInfo.attach('redacted-browser-events', { path: eventsFile, contentType: 'application/x-ndjson' })
    if (summary.journal.error) throw new Error(`Event journal failed: ${summary.journal.error.code || 'write error'}`)
  }
})
