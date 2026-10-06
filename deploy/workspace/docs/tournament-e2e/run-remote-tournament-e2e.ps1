[CmdletBinding(DefaultParameterSetName='Browser')]
param(
    [Parameter(Mandatory=$true, ParameterSetName='Browser')][string]$ServerManifest,
    [Parameter(Mandatory=$true, ParameterSetName='Audit')][string]$RunDirectory,
    [Parameter(Mandatory=$true, ParameterSetName='Audit')][switch]$AuditOnly,
    [ValidateSet(16,32)][int]$Players = 16,
    [ValidateSet('chrome','msedge','chromium')][string]$Browser = 'chrome',
    [switch]$Headed,
    [switch]$Comprehensive,
    [ValidatePattern('^/[A-Za-z0-9_/-]+/backgammon-project$')][string]$ServerRoot = '/home/dev/backgammon-project'
)
$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskPreviousBrowser = $env:E2E_BROWSER
$taskPreviousHeaded = $env:E2E_HEADED
$taskExitCode = 1
$taskRunSummary = $null
$taskInvocation = $null
function Save-CombinedRunReport($Directory, $Value) {
    $taskShareDirectory = Join-Path $Directory 'share-report'
    if (-not (Test-Path -LiteralPath $taskShareDirectory)) { New-Item -ItemType Directory -Path $taskShareDirectory | Out-Null }
    $taskEncoded = ($Value | ConvertTo-Json -Depth 32) + "`n"
    $taskUtf8 = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText((Join-Path $Directory 'run-summary.json'), $taskEncoded, $taskUtf8)
    [IO.File]::WriteAllText((Join-Path $taskShareDirectory 'run-summary.json'), $taskEncoded, $taskUtf8)
}
try {
    $taskWorkspace = [IO.DirectoryInfo]$PSScriptRoot
    $taskRepositories = @('Backgammon Game','backgammon-tournaments','backgammon-tournaments-backend','backgammon-analysis-service')
    while ($taskWorkspace) {
        $taskMissing = @($taskRepositories | Where-Object { -not (Test-Path -LiteralPath (Join-Path $taskWorkspace.FullName $_) -PathType Container) })
        if ($taskMissing.Count -eq 0) { break }
        $taskWorkspace = $taskWorkspace.Parent
    }
    if (-not $taskWorkspace) { throw 'Cannot find the Backgammon workspace.' }
    $taskRuns = Join-Path $taskWorkspace.FullName 'docs\tournament-e2e-integrations\runs'
    if (-not $AuditOnly) {
        $taskExisting = @(Get-ChildItem -LiteralPath $taskRuns -Directory -ErrorAction SilentlyContinue | ForEach-Object Name)
        $env:E2E_BROWSER = $Browser
        $env:E2E_HEADED = $(if ($Headed) { '1' } else { '0' })
        $taskScope = $(if ($Comprehensive) { 'comprehensive' } else { 'auto' })
        & $taskNode (Join-Path $PSScriptRoot 'run-remote-e2e.mjs') (Resolve-Path -LiteralPath $ServerManifest).Path ([string]$Players) $taskScope
        $taskExitCode = $LASTEXITCODE
        if (-not $Comprehensive) { exit $taskExitCode }
        $taskNew = @(Get-ChildItem -LiteralPath $taskRuns -Directory | Where-Object { $_.Name -notin $taskExisting })
        if ($taskNew.Count -ne 1) { throw 'Cannot identify exactly one new browser run for the server audit.' }
        $RunDirectory = $taskNew[0].FullName
    }
    $taskRun = (Resolve-Path -LiteralPath $RunDirectory).Path
    $taskSummaryFile = Join-Path $taskRun 'tournament-summary.json'
    $taskSummary = Get-Content -LiteralPath $taskSummaryFile -Raw | ConvertFrom-Json
    $taskRunId = [string]$taskSummary.runId
    $taskSessionId = [string]$taskSummary.targetSession
    $taskExpected = [IO.Path]::GetFullPath((Join-Path $taskRuns $taskRunId))
    if ($taskRunId -notmatch '^[A-Za-z0-9_-]{10,80}$' -or $taskSessionId -notmatch '^[a-f0-9]{32}$' -or $taskRun -ne $taskExpected -or $taskSummary.status -ne 'passed') {
        throw 'Server audit requires a completed browser run in the existing runs directory.'
    }
    $taskInvocation = [Guid]::NewGuid().ToString('N')
    $taskRunSummary = Get-Content -LiteralPath (Join-Path $taskRun 'run-summary.json') -Raw | ConvertFrom-Json
    $taskRunSummary.serverVerification = @{ passed=$false; status='pending'; invocation=$taskInvocation; report='server-operations.json' }
    $taskRunSummary.passed = $false
    Save-CombinedRunReport $taskRun $taskRunSummary
    $taskDestination = 'administrator@38.247.146.17'
    $taskRemoteSummary = "$ServerRoot/reports/e2e-tournament-summary.json"
    & scp.exe $taskSummaryFile "${taskDestination}:$taskRemoteSummary"
    if ($LASTEXITCODE -ne 0) { throw 'Summary upload failed; server audit was not started.' }
    # The server discovers its existing installed tools from the prepared session.
    # No source, activation script, baseline or client credentials are uploaded.
    $taskRemotePython = @'
import json, subprocess, sys, time
from pathlib import Path
root = Path('SERVER_ROOT')
rehearsal = root / 'backups/backgammon-backups/rehearsal-20261005T184922Z/docker-rehearsal'
state = rehearsal / 'browser-e2e-r2'
session = json.loads((state / 'session.json').read_text())
summary = root / 'reports/e2e-tournament-summary.json'
browser = json.loads(summary.read_text())
if browser.get('runId') != 'RUN_ID' or browser.get('targetSession') != 'SESSION_ID' or session['identity']['session_id'] != 'SESSION_ID':
    raise ValueError('Browser summary and server session do not match this invocation')
project = root / 'deploy/backgammon-deploy/bg-20261005-git-r2'
tools = Path(session['tools_dir']).resolve(strict=True)
if not project.samefile(session['project_dir']) or not rehearsal.samefile(session['rehearsal_dir']) or not tools.parent.samefile(root / 'tools'):
    raise ValueError('Managed layout differs from the prepared session directories')
started = time.time_ns()
result = subprocess.run(['python3', str(tools / 'server_rehearsal.py'), 'audit', '--project', str(project),
                         '--rehearsal', str(rehearsal), '--summary', str(summary)])
reports = root / 'reports/tournament-e2e' / 'RUN_ID'
for prefix, name in (('operations-', 'server-operations.json'), ('entry-flow-', 'entry-flow-server.json')):
    source = state / 'audit' / (prefix + 'RUN_ID' + '.json')
    if not source.is_file() or source.is_symlink() or source.stat().st_mtime_ns < started:
        raise RuntimeError('A fresh server report is unavailable: ' + name)
    value = json.loads(source.read_text())
    # Both reports retain their original identity field names.
    run_key, session_key = ('run_id', 'session_id') if name == 'server-operations.json' else ('runId', 'sessionId')
    if value.get(run_key) != 'RUN_ID' or value.get(session_key) != 'SESSION_ID':
        raise ValueError('Server report belongs to another run: ' + name)
    value['export_invocation'] = 'INVOCATION_ID'
    reports.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination = reports / name
    if destination.is_symlink():
        raise ValueError('Unsafe report export destination')
    destination.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    destination.chmod(0o600)
sys.exit(result.returncode)
'@
    $taskRemotePython = $taskRemotePython.Replace('SERVER_ROOT', $ServerRoot).Replace('RUN_ID', $taskRunId).Replace('SESSION_ID', $taskSessionId).Replace('INVOCATION_ID', $taskInvocation)
    $taskRemoteEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskRemotePython))
    # Base64 carries this fixed program through Windows/OpenSSH quoting unchanged.
    & ssh.exe -t $taskDestination "printf %s $taskRemoteEncoded | base64 --decode | python3"
    $taskAuditExit = $LASTEXITCODE
    $taskShare = Join-Path $taskRun 'share-report'
    if (-not (Test-Path -LiteralPath $taskShare)) { New-Item -ItemType Directory -Path $taskShare | Out-Null }
    $taskRemoteReports = "$ServerRoot/reports/tournament-e2e/$taskRunId"
    & scp.exe "${taskDestination}:${taskRemoteReports}/server-operations.json" (Join-Path $taskShare 'server-operations.json')
    if ($LASTEXITCODE -ne 0) { throw 'Server report download failed; inspect the saved report on the server.' }
    & scp.exe "${taskDestination}:${taskRemoteReports}/entry-flow-server.json" (Join-Path $taskShare 'entry-flow-server.json')
    if ($LASTEXITCODE -ne 0) { throw 'Entry report download failed.' }
    $taskServerReport = Get-Content -LiteralPath (Join-Path $taskShare 'server-operations.json') -Raw | ConvertFrom-Json
    if ($taskServerReport.run_id -ne $taskRunId -or $taskServerReport.session_id -ne $taskSessionId -or $taskServerReport.export_invocation -ne $taskInvocation) {
        throw 'Downloaded server report belongs to another run.'
    }
    $taskEntryReport = Get-Content -LiteralPath (Join-Path $taskShare 'entry-flow-server.json') -Raw | ConvertFrom-Json
    if ($taskEntryReport.runId -ne $taskRunId -or $taskEntryReport.sessionId -ne $taskSessionId -or $taskEntryReport.export_invocation -ne $taskInvocation) {
        throw 'Downloaded entry report belongs to another run.'
    }
    $taskAuditPassed = $taskAuditExit -eq 0 -and $taskServerReport.database_audits_passed -eq $true
    $taskRunSummary.serverVerification = @{ passed=$taskAuditPassed; status=$(if ($taskAuditPassed) { 'passed' } else { 'failed' }); invocation=$taskInvocation; report='server-operations.json'; exitCode=$taskAuditExit }
    $taskRunSummary.passed = $taskRunSummary.browserPassed -eq $true -and $taskRunSummary.performanceAcceptance.passed -eq $true -and $taskAuditPassed
    Save-CombinedRunReport $taskRun $taskRunSummary
    $taskExitCode = $(if ($taskRunSummary.passed) { 0 } else { 1 })
    Write-Host "COMBINED REPORT DIRECTORY: $taskShare"
} catch {
    if ($taskRunSummary -and $taskInvocation) {
        $taskRunSummary.serverVerification.status = 'incomplete'
        $taskRunSummary.serverVerification.passed = $false
        $taskRunSummary.passed = $false
        Save-CombinedRunReport $taskRun $taskRunSummary
    }
    throw
} finally {
    $env:E2E_BROWSER = $taskPreviousBrowser
    $env:E2E_HEADED = $taskPreviousHeaded
}
exit $taskExitCode
