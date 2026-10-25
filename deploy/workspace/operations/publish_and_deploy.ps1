<#
.SYNOPSIS
Runs the Backgammon release tool against committed workspace sources.
.DESCRIPTION
The default command runs the remaining verified checks, publishes exact commits
and deploys production. Normal retries automatically reuse eligible completed
phases; Fresh deliberately starts their checks again. No commits are created.
.PARAMETER WorkspaceRoot
Folder containing all four application repositories and the local release receipts.
.PARAMETER ChecksOnly
Runs local tests and builds without publication or SSH.
.PARAMETER PreflightOnly
Checks local prerequisites without tests, builds, publication or SSH.
.PARAMETER Status
Displays saved local release progress without Git, Node, Docker or SSH checks.
.PARAMETER Fresh
Rechecks all phases. Omit this switch when retrying its failed run.
.PARAMETER ResumeFrom
Supported historical release ID; ordinary retries do not need this parameter.
.EXAMPLE
.\publish_and_deploy.ps1 -Status
.EXAMPLE
.\publish_and_deploy.ps1 -ChecksOnly
.EXAMPLE
.\publish_and_deploy.ps1 -WorkspaceRoot 'C:\Projects\backgammon' -PreflightOnly
#>
[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path,
    [switch]$ChecksOnly,
    [switch]$PreflightOnly,
    [switch]$Status,
    [switch]$Fresh,
    [string]$ResumeFrom
)
$ErrorActionPreference = 'Stop'

if (($ChecksOnly -and $PreflightOnly) -or ($Status -and ($ChecksOnly -or $PreflightOnly))) {
    Write-Host 'Choose only one of ChecksOnly, PreflightOnly or Status.' -ForegroundColor Red
    exit 2
}
if ($Fresh -and $ResumeFrom) {
    Write-Host 'Fresh and ResumeFrom cannot be combined.' -ForegroundColor Red
    exit 2
}
if ($Status -and ($Fresh -or $ResumeFrom)) {
    Write-Host 'Status cannot be combined with Fresh or ResumeFrom.' -ForegroundColor Red
    exit 2
}

$taskRetryLauncher = Join-Path $WorkspaceRoot 'PUBLISH_AND_DEPLOY.ps1'
$taskRetry = "& '" + $taskRetryLauncher.Replace("'", "''") + "'"
if (-not (Test-Path -LiteralPath $taskRetryLauncher -PathType Leaf)) {
    $taskRetry = "& '" + $PSCommandPath.Replace("'", "''") + "' -WorkspaceRoot '" + $WorkspaceRoot.Replace("'", "''") + "'"
}
if ($ChecksOnly) { $taskRetry += ' -ChecksOnly' }
if ($PreflightOnly) { $taskRetry += ' -PreflightOnly' }
if ($Status) { $taskRetry += ' -Status' }
if ($ResumeFrom) { $taskRetry += " -ResumeFrom '" + $ResumeFrom.Replace("'", "''") + "'" }

try {
    $taskMode = 'Tests, publication and production deployment'
    if ($ChecksOnly) { $taskMode = 'Local tests and builds; no push or SSH' }
    if ($PreflightOnly) { $taskMode = 'Local prerequisites; no tests, builds, push or SSH' }
    if ($Status) { $taskMode = 'Saved local release status; no checks or deployment' }
    Write-Host "Mode: $taskMode"
    if ($Fresh) { Write-Host 'Fresh run: completed phases will be checked again.' }
    if ($ResumeFrom) { Write-Host "Historical continuation: $ResumeFrom" }

    $taskTool = Join-Path $PSScriptRoot 'release_pipeline.py'
    if (-not (Test-Path -LiteralPath $taskTool -PathType Leaf)) {
        throw "Release tool not found: $taskTool"
    }
    $taskCandidates = @(
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'),
        (Join-Path $WorkspaceRoot 'Backgammon Game\backend\.venv\Scripts\python.exe')
    )
    $taskSystemPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($taskSystemPython) { $taskCandidates += $taskSystemPython.Source }
    $taskPython = $null
    foreach ($taskCandidate in $taskCandidates) {
        if (Test-Path -LiteralPath $taskCandidate -PathType Leaf) {
            try {
                & $taskCandidate -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' 2>$null
                if ($LASTEXITCODE -eq 0) { $taskPython = $taskCandidate; break }
            } catch { continue }
        }
    }
    if (-not $taskPython) { throw 'Python 3.12+ is required. No checks, publication or deployment started.' }
    $taskArguments = @($taskTool, '--root', $WorkspaceRoot)
    if ($ChecksOnly) { $taskArguments += '--checks-only' }
    if ($PreflightOnly) { $taskArguments += '--preflight-only' }
    if ($Status) { $taskArguments += '--status' }
    if ($Fresh) { $taskArguments += '--fresh' }
    if ($ResumeFrom) { $taskArguments += @('--resume-from', $ResumeFrom) }
    & $taskPython @taskArguments
    $taskExitCode = $LASTEXITCODE
}
catch {
    Write-Host "Launcher error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Retry after resolving the error: $taskRetry"
    exit 1
}

if ($taskExitCode -ne 0) {
    Write-Host "Command stopped (exit $taskExitCode). See the error above." -ForegroundColor Red
    Write-Host "Retry after resolving the error: $taskRetry"
}
exit $taskExitCode
