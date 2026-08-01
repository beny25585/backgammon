# Component Testing Suite — Design

Date: 2026-08-01
Status: Approved

## Goal

Give the frontend a real automated test suite covering every component in
`src/components/`, using **Playwright Component Testing** (`@playwright/experimental-ct-react`).
Tests are **colocated** inside each component folder as `<Component>.test.tsx`
(next to the `.tsx` and `.module.css`), not in a central tests folder.

The suite covers four test types, all in real Chromium:
1. Render smoke / unit assertions
2. Layout & responsiveness (viewport matrix, no overflow, key geometry)
3. Functional interactions (clicks/taps)
4. Visual snapshots (golden screenshots)

No backend is required — all API/socket dependencies are mocked.

## Approach

Chosen approach: **A — Playwright Component Testing** (real Chromium rendering,
per-test viewport control, `toHaveScreenshot()`, colocated test files, one runner).

Rejected: B (Vitest + jsdom + separate browser scripts — two runners, jsdom can't
measure real layout), C (hand-rolled playwright-core harness — no runner/reporting/snapshots).

## Infrastructure

- Dev deps (install via **pnpm** — npm is broken in this environment):
  `@playwright/test`, `@playwright/experimental-ct-react`
- `frontend/playwright-ct.config.ts`:
  - `testDir: ./src`, `testMatch: **/*.test.tsx`
  - Reuse the existing Vite config via `ctViteConfig` (CSS modules, Tailwind v4, aliases)
  - Launch system Chromium: `use.launchOptions.executablePath` from env
    `CHROMIUM_PATH`, `use.launchOptions.env.LD_LIBRARY_PATH` from env
    `BG_CHROMIUM_LIBS`. On this machine, fall back to the known-good values
    (`/usr/bin/chromium` and the extracted libs under `/tmp/opencode/libs/...`).
  - Viewports set per-test via `page.setViewportSize()`.
  - Global test setup injects CSS that disables `motion`/CSS animations so
    snapshots are deterministic.
- `package.json` scripts:
  - `pnpm test` — headless run
  - `pnpm test:update` — regenerate golden screenshots
  - `pnpm test:headed` — visible browser
- Remove the ad-hoc harness: `frontend/test-board.tsx`, `frontend/test-board.html`
  (layout checks migrate into `GameBoard.test.tsx` / `BearOff.test.tsx`).

## Colocation & shared helpers

- Each component folder: `<Component>.tsx`, `<Component>.module.css`, `<Component>.test.tsx`.
- Shared utilities live in `src/test-utils/`:
  - `mockContexts.tsx` — mock `GameContext` and `LocalGameContext` provider values
    (no socket connection; mirrors the current `test-board.tsx` approach)
  - `fixtures.ts` — board states (mid-game, opening roll, no-moves, game over,
    bar/bear-off) + API payloads (rooms, matches, stats)
  - `wrappers.tsx` — `MemoryRouter` + context wrapper components
  - `viewportChecks.ts` — `assertNoHorizontalOverflow`, `assertFillsParent`,
    `assertBelow(a, b)` helpers
  - `interceptApi.ts` — `page.route()` helpers for `**/api/**`
  - `setup.ts` — global animation-disable + fake-token seeding

## Mocking strategy

- **Game/socket components** (GameBoard, SidePanel, Dice, Controls, DoublingCube,
  TurnIndicator, OpponentBar, GameResultOverlay, GameScreen, Board pieces/buttons):
  rendered inside a mock `GameContext.Provider` with fixture board states.
  No WebSocket is ever opened.
- **API-driven components** (AuthScreen, HomeScreen, LobbyPage, WaitingRoom,
  MatchHistory, MatchDetail, StatsSection): `page.route()` intercepts `**/api/**`
  and returns fixture JSON. Tests seed `localStorage` with a fake token for any
  component calling `getAccessToken()`.
- **Router users**: wrapped in `MemoryRouter`.

## Coverage matrix

Every component folder gets a `<Name>.test.tsx`. Minimum: render smoke test.
Beyond that:

| Component | Layout matrix | Interactions | Snapshot |
|---|---|---|---|
| AuthScreen | ✓ | login / register flows (intercepted API) | ✓ |
| HomeScreen | ✓ | menu nav buttons | ✓ |
| WaitingRoom | ✓ | leave room | ✓ |
| LobbyPage | ✓ | create / join room | ✓ |
| GameScreen | ✓ | roll prompt, overlays | ✓ |
| GameBoard | ✓ | click checker → move, undo | ✓ |
| Board pieces (bar, bearoff, checker, pointcell) | ✓ | — | ✓ |
| Board buttons (confirm, undo) | — | click handlers | — |
| Dice | — | roll button | ✓ |
| Controls | ✓ | double / undo / end-turn / give-up | — |
| DoublingCube | — | accept / decline | ✓ |
| TurnIndicator | — | — | — |
| OpponentBar | ✓ | — | ✓ |
| SidePanel | ✓ | give up / leave | ✓ |
| GameResultOverlay | ✓ | next game / home | ✓ |
| MatchHistory | ✓ | pagination | ✓ |
| MatchDetail | ✓ | replay stepping | ✓ |
| MatchSettings | — | target-points select | — |
| StatsSection | — | — | — |
| AnimatedTabs | — | tab switch | — |

Plus pure unit tests for `lib/backgammon/engine.ts` (legal moves, gammon/
backgammon detection, doubling-cube rules, opening roll) colocated as
`engine.test.ts` — same runner, no browser mount.

### Layout matrix

Desktop **1280×800**, mobile **390×844**, landscape **850×400**:
- No horizontal overflow (`scrollWidth <= innerWidth`)
- Board geometry: bear-off column fills full board height; points never overflow `inner`
- Side panel: stacked full-width below board on mobile; 30% column beside board on desktop

## Running & snapshots

- Golden screenshots committed in `__snapshots__/` next to each test file.
- First run for new snapshots uses `pnpm test:update`.
- README documents the `CHROMIUM_PATH` / `BG_CHROMIUM_LIBS` requirement.
- CI-ready: single command, fully mocked, no backend.

## Success criteria

- `pnpm test` passes headless in this environment.
- Every folder in `src/components/` has a colocated `.test.tsx`.
- The board-fit and mobile-stack regression checks we validated manually are now
  automated in the suite.
- Ad-hoc harness files (`test-board.*`) removed.
