# Gameplay performance audit — 2026-09-06

The reported symptom was a checker pausing or jumping near the end of a move in online play. The target browsers are Chrome, Microsoft Edge and Safari, with priority on Android phones and iPhones.

## Changes

- Checker flight coordinates now use the actual positioned wrapper. Previously the board's inset introduced a roughly 7–9 px jump on landing. Hitting an opposing blot also uses the replacement checker's slot instead of an extra stack slot.
- The next move can start as soon as the previous move is reflected in game state. An unfinished visual animation no longer swallows that input. Flight IDs prevent an older completion callback from clearing a newer animation.
- The opponent's first move is animated even when the initial move history is empty. Consecutive remote updates replace the active flight instead of leaving an obsolete checker animation.
- Scheduled WebSocket reconnects are cancelled when leaving or switching rooms. Failed sends do not create an optimistic move that the server never received. A fresh connection clears the connection error and resets the state-version filter, including a version-zero snapshot.
- Compact landscape styling now covers short screens wider than 800 CSS pixels, including 844 × 390 phones. Previously those screens missed the compact board and side-panel rules.

Existing optimistic move handling was exercised with four rapid moves, delayed acknowledgements, duplicate stale updates, rejection and reconnection. Backend fixtures were corrected to test sorted dice through the random-die helper and to use a legal ambiguous bear-off position.

## Local measurements

Chrome on Windows, one profiling worker, real CSS animations enabled, 40 consecutive state updates per viewport. Phone-sized viewports used 4× CPU throttling. These are synthetic component measurements, not physical-device or production-network measurements.

| Scenario | Frame interval p95 | Maximum interval | Main-thread tasks over 50 ms |
| --- | ---: | ---: | ---: |
| 844 × 390, before landscape fix, CPU 4× | 48.6 ms | 76.3 ms | 11 |
| 844 × 390, after landscape fix, CPU 4× | 27.8 ms | 62.5 ms | 0 |
| 736 × 414, after fix, CPU 4× | 27.8 ms | 41.7 ms | 0 |
| 1280 × 800, after fix, CPU 1× | 7.0 ms | 27.8 ms | 0 |

The 844 px case improved by approximately 43% at p95 in this comparison. Isolated frame gaps remain under CPU throttling; zero long main-thread tasks does not mean zero dropped frames. Measurements depend on host load and screen refresh rate, so the profiling test records metrics rather than enforcing a machine-specific timing threshold.

An additional deterministic engine-only run completed 100 games and 21,299 moves while checking checker conservation. Move computation p95 was 0.003 ms and the maximum was 0.448 ms. This does not measure rendering, server latency or socket delivery.

## Verification

- Chrome 152.0.7977.76: 247 functional tests passed.
- Playwright WebKit: 247 functional tests passed.
- Edge 152.0.4191.66: 247 functional tests passed.
- Chrome profiling: all three viewport scenarios passed, with no uncaught page errors or leftover animated checkers.
- Django game suite: 229 tests passed using an isolated test database and disabled local tournament integration.
- TypeScript, production build and targeted ESLint checks passed; the responsive test file retains one existing `no-explicit-any` warning.

Responsive coverage includes phone portrait/landscape, tablet portrait/landscape and desktop. The animation regressions check exact landing coordinates with empty, occupied, tall and opposing-blot destinations. Cross-browser tests wait for rendered state before advancing a frozen clock or inspecting asynchronous callback results.

## Repeat the frontend checks

From `frontend`, with dependencies installed (PowerShell):

```powershell
$env:TEST_BROWSER = 'chromium'
$env:CHROMIUM_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node node_modules/@playwright/test/cli.js test -c playwright-ct.config.ts --grep-invert 'profiles a live board' --workers=2

$env:CHROMIUM_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
node node_modules/@playwright/test/cli.js test -c playwright-ct.config.ts --grep-invert 'profiles a live board' --workers=2

# Use the directory where Playwright WebKit is installed, if non-default.
$env:PLAYWRIGHT_BROWSERS_PATH = '../../.codex-run/playwright-browsers'
$env:TEST_BROWSER = 'webkit'
node node_modules/@playwright/test/cli.js test -c playwright-ct.config.ts --grep-invert 'profiles a live board' --workers=2

$env:TEST_BROWSER = 'chromium'
$env:CHROMIUM_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node node_modules/@playwright/test/cli.js test -c playwright-ct.config.ts GameScreen.performance.test.tsx --workers=1

node node_modules/typescript/bin/tsc --noEmit
node node_modules/vite/bin/vite.js build
```

## Remaining device validation

WebKit on Windows exercises Safari's engine family but is not Safari running on an iPhone. CPU throttling and viewport sizes do not reproduce Android hardware or its GPU. Real-device online play on Android Chrome and iPhone Safari is still required to establish device-specific smoothness, particularly with weak connectivity, background/resume and orientation changes. No production deployment was performed as part of this audit.
