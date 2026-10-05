[CmdletBinding()]
param([switch]$Full, [switch]$E2E, [switch]$Headed, [ValidateSet(16, 32)][int]$Players = 16,
    [switch]$RecoveryChecks, [string]$NginxExecutable, [string]$ServerReference)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$taskPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Bundled Python was not found; configure taskPython in this script.' }
$taskDir = Join-Path $PSScriptRoot ('validation\' + (Get-Date -Format 'yyyyMMddTHHmmss'))
New-Item -ItemType Directory -Path $taskDir | Out-Null
$taskLog = Join-Path $taskDir 'validation.txt'
$taskResults = [System.Collections.Generic.List[object]]::new()
$taskPreviousResult = $env:AUDIT_RESULT_FILE
$taskPreviousChromium = $env:CHROMIUM_PATH
$taskPreviousLocation = Get-Location
function Invoke-TaskCheck {
    param([string]$Name, [string]$Directory, [string]$File, [string[]]$Arguments)
    Set-Location -LiteralPath $Directory
    "`nCHECK: $Name`nUTC: $([DateTime]::UtcNow.ToString('o'))" | Tee-Object -FilePath $taskLog -Append
    $taskStarted = Get-Date
    $taskPriorPreference = $ErrorActionPreference
    try {
        Get-Command $File -ErrorAction Stop | Out-Null
        $ErrorActionPreference = 'Continue'
        $LASTEXITCODE = 0
        & $File @Arguments 2>&1 | Tee-Object -FilePath $taskLog -Append
        $taskCode = $LASTEXITCODE
    } catch {
        $taskCode = 1
        "CHECK COULD NOT START: $($_.Exception.Message)" | Tee-Object -FilePath $taskLog -Append
    } finally { $ErrorActionPreference = $taskPriorPreference }
    $taskResults.Add([pscustomobject]@{ name=$Name; exitCode=$taskCode; seconds=((Get-Date)-$taskStarted).TotalSeconds })
    "RESULT: $Name exit=$taskCode" | Tee-Object -FilePath $taskLog -Append
}
try {
    'BACKGAMMON REPAIR VALIDATION - focused suites use isolated SQLite; optional E2E uses PostgreSQL + built UI/Nginx; no production services or notifications' | Set-Content -LiteralPath $taskLog -Encoding UTF8
    foreach ($taskBrowserPath in @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')) {
        if (Test-Path -LiteralPath $taskBrowserPath) { $env:CHROMIUM_PATH = $taskBrowserPath; break }
    }
    $taskTourRunner = Join-Path $taskRoot 'docs\incident-validation-2026-10-05\tournaments-backend\run_isolated.py'
    $taskGameRunner = Join-Path $taskRoot 'docs\incident-validation-2026-10-05\game-backend\run_game_checks.py'
    $env:AUDIT_RESULT_FILE = 'repair-focused-game-results.json'
    Invoke-TaskCheck 'tournament-focused' $taskRoot $taskPython @('-u', $taskTourRunner,
        'frontend.test_search_lifecycle', 'frontend.test_entry_lifecycle', 'frontend.test_game_formats',
        'frontend.test_tasks', 'frontend.test_task_ownership', 'frontend.test_incident_recovery',
        'tournaments.test_wallet_idempotency', 'frontend.test_incident_reads', 'frontend.test_analysis_results',
        'frontend.test_control_room', 'gamelink.test_entry_admission', 'gamelink.test_status_events',
        'gamelink.tests.ResultCallbackViewTest', 'tournaments.test_stage_query_budget', '--verbosity', '1')
    Invoke-TaskCheck 'game-focused' $taskRoot $taskPython @('-u', $taskGameRunner,
        'game.tests.test_recurring_tasks', 'game.tests.test_task_ownership', 'game.tests.test_action_latency',
        'game.tests.test_connection_setup', 'game.tests.test_room_execution', 'game.tests.test_expiry_ownership',
        'game.tests.integration.test_presence', 'game.tests.gameplay.test_turn_intents',
        'game.link.test_status_events', 'game.link.test_live_snapshot_consistency', 'game.link.test_entry_diagnostics',
        'game.link.tests.EnterLinkTests', 'game.link.tests.DeliveryRetryTests', 'game.link.tests.EnqueueResultTests')
    Invoke-TaskCheck 'harness' $taskRoot 'node' @('--test', 'docs/tournament-e2e/event-journal.test.mjs',
        'docs/tournament-e2e/scenario-config.test.mjs', 'docs/tournament-e2e/game-driver.test.mjs')
    Invoke-TaskCheck 'result-analysis-ui' (Join-Path $taskRoot 'Backgammon Game\frontend') 'node' @(
        'node_modules/@playwright/test/cli.js', 'test', '-c', 'playwright-ct.config.ts',
        'src/components/GameResult/ResultSummary.test.tsx', '--workers=1')
    if ($Full -and -not ($taskResults | Where-Object exitCode -ne 0)) {
        $env:AUDIT_RESULT_FILE = 'repair-full-game-results.json'
        Invoke-TaskCheck 'tournament-full' $taskRoot $taskPython @('-u', $taskTourRunner, '--verbosity', '1')
        Invoke-TaskCheck 'game-full' $taskRoot $taskPython @('-u', $taskGameRunner)
        Invoke-TaskCheck 'tournament-ui-full' (Join-Path $taskRoot 'backgammon-tournaments') 'node' @('node_modules/vitest/vitest.mjs', 'run', '--environment', 'jsdom')
        Invoke-TaskCheck 'tournament-admin-ui-full' (Join-Path $taskRoot 'backgammon-tournaments-backend\admin-frontend') 'pnpm.cmd' @('exec', 'vitest', 'run')
        Invoke-TaskCheck 'game-build' (Join-Path $taskRoot 'Backgammon Game\frontend') 'pnpm.cmd' @('build')
        Invoke-TaskCheck 'tournament-build' (Join-Path $taskRoot 'backgammon-tournaments') 'pnpm.cmd' @('build')
        Invoke-TaskCheck 'tournament-admin-build' (Join-Path $taskRoot 'backgammon-tournaments-backend\admin-frontend') 'pnpm.cmd' @('build')
    }
    if ($E2E -and -not ($taskResults | Where-Object exitCode -ne 0)) {
        $taskE2EStarted = Get-Date
        $taskE2EArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run-tournament-e2e.ps1'))
        $taskE2EArgs += @('-Players', [string]$Players)
        if ($RecoveryChecks) { $taskE2EArgs += '-RecoveryChecks' }
        if ($NginxExecutable) { $taskE2EArgs += @('-NginxExecutable', $NginxExecutable) }
        if ($ServerReference) { $taskE2EArgs += @('-ServerReference', $ServerReference) }
        if ($Headed) { $taskE2EArgs += '-Headed' }
        Invoke-TaskCheck "$Players-player-e2e" $taskRoot 'powershell.exe' $taskE2EArgs
        $taskE2EReport = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'runs') -Filter '*-report.zip' -File |
            Where-Object LastWriteTime -ge $taskE2EStarted | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($taskE2EReport) { Copy-Item -LiteralPath $taskE2EReport.FullName -Destination $taskDir }
    }
} finally {
    $env:AUDIT_RESULT_FILE = $taskPreviousResult
    $env:CHROMIUM_PATH = $taskPreviousChromium
    Set-Location -LiteralPath $taskPreviousLocation.Path
    $taskResults | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDir 'checks.json') -Encoding UTF8
    foreach ($taskResultFile in @('repair-focused-game-results.json', 'repair-full-game-results.json')) {
        $taskSource = Join-Path $taskRoot ('docs\incident-validation-2026-10-05\game-backend\' + $taskResultFile)
        if ((Test-Path -LiteralPath $taskSource) -and (Get-Item -LiteralPath $taskSource).LastWriteTime -ge (Get-Item -LiteralPath $taskLog).CreationTime) {
            Copy-Item -LiteralPath $taskSource -Destination $taskDir
        }
    }
    $taskZip = $taskDir + '-report.zip'
    Compress-Archive -LiteralPath $taskDir -DestinationPath $taskZip
    Write-Host "SEND VALIDATION FILE: $taskZip"
}
if ($taskResults | Where-Object exitCode -ne 0) { exit 1 }
