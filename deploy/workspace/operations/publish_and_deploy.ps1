[CmdletBinding()]
param(
    [string]$WorkspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path,
    [switch]$ChecksOnly,
    [switch]$PreflightOnly,
    [string]$ResumeFrom
)
$ErrorActionPreference = 'Stop'
$taskTool = Join-Path $PSScriptRoot 'release_pipeline.py'
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
if (-not $taskPython) { throw 'Python 3.12+ is required. No tests, Git publication or deployment started.' }
$taskArguments = @($taskTool, '--root', $WorkspaceRoot)
if ($ChecksOnly) { $taskArguments += '--checks-only' }
if ($PreflightOnly) { $taskArguments += '--preflight-only' }
if ($ResumeFrom) { $taskArguments += @('--resume-from', $ResumeFrom) }
& $taskPython @taskArguments
if ($LASTEXITCODE -ne 0) { throw 'Publication/deployment stopped. Read the stage, error and log path printed above before retrying.' }
