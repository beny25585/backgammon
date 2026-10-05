[CmdletBinding()]
param(
    [ValidateSet('chrome', 'msedge', 'chromium')]
    [string]$Browser = 'chrome',
    [switch]$Headed,
    [ValidateSet(16, 32)]
    [int]$Players = 16,
    [switch]$RecoveryChecks,
    [string]$GamePython,
    [string]$TournamentPython,
    [string]$RedisExecutable,
    [ValidateSet('sqlite', 'postgresql')]
    [string]$Database = 'postgresql',
    [ValidateSet('dev', 'production')]
    [string]$UiMode = 'production',
    [string]$NginxExecutable,
    [ValidateRange(1, 65535)]
    [int]$PostgresPort = 55432,
    [string]$PostgresAdminPasswordFile,
    [string]$PostgresDataDirectory,
    [string]$ServerReference,
    [string]$ReleaseManifest
)

$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskRunId = (Get-Date -Format 'yyyyMMddTHHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$taskRunDir = Join-Path $PSScriptRoot ('runs\' + $taskRunId)
$taskWorkspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$taskEnvironmentNames = @('E2E_BROWSER', 'E2E_HEADED', 'E2E_GAME_PYTHON', 'E2E_TOURNAMENT_PYTHON', 'E2E_REDIS_EXE',
    'E2E_UI_MODE', 'E2E_PROFILE', 'E2E_GAME_ROOT', 'E2E_TOURNAMENT_ROOT', 'E2E_GAME_FRONTEND',
    'E2E_TOURNAMENT_FRONTEND', 'E2E_DICE_ROOT', 'E2E_GAME_COMMIT', 'E2E_TOURNAMENT_COMMIT', 'E2E_UI_COMMIT',
    'E2E_DATABASE_MODE', 'E2E_PG_PORT', 'E2E_PG_ADMIN_PASSWORD_FILE', 'E2E_PG_DATA_DIRECTORY',
    'E2E_NGINX', 'E2E_SERVER_REFERENCE', 'E2E_RELEASE_MANIFEST', 'E2E_PLAYER_COUNT', 'E2E_RECOVERY_CHECKS')
$taskPreviousEnvironment = @{}
foreach ($taskName in $taskEnvironmentNames) {
    $taskPreviousEnvironment[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process')
}
$taskExitCode = 1
try {
    # Always exercise this workspace's current files, including uncommitted
    # fixes. Do not inherit candidate-server paths or commit labels.
    if (-not $NginxExecutable) {
        $taskProjectNginx = Join-Path $taskWorkspace 'tools\nginx-1.31.6\nginx.exe'
        if (Test-Path -LiteralPath $taskProjectNginx -PathType Leaf) {
            $NginxExecutable = $taskProjectNginx
        } elseif ($env:E2E_NGINX) {
            $NginxExecutable = $env:E2E_NGINX
        }
    }
    if (-not $TournamentPython -and -not $env:E2E_TOURNAMENT_PYTHON) {
        $taskProjectTournamentPython = Join-Path $taskWorkspace 'backgammon-tournaments-backend\venv\Scripts\python.exe'
        if (Test-Path -LiteralPath $taskProjectTournamentPython -PathType Leaf) {
            $TournamentPython = $taskProjectTournamentPython
        }
    }
    $env:E2E_UI_MODE = $UiMode
    $env:E2E_DATABASE_MODE = $Database
    $env:E2E_PG_PORT = [string]$PostgresPort
    $env:E2E_PG_ADMIN_PASSWORD_FILE = $PostgresAdminPasswordFile
    $env:E2E_PG_DATA_DIRECTORY = $PostgresDataDirectory
    $env:E2E_NGINX = $NginxExecutable
    $env:E2E_SERVER_REFERENCE = $ServerReference
    $env:E2E_RELEASE_MANIFEST = $ReleaseManifest
    $env:E2E_PLAYER_COUNT = [string]$Players
    $env:E2E_RECOVERY_CHECKS = $(if ($RecoveryChecks) { '1' } else { '0' })
    $env:E2E_PROFILE = 'local'
    $env:E2E_GAME_ROOT = Join-Path $taskWorkspace 'Backgammon Game\backend'
    $env:E2E_TOURNAMENT_ROOT = Join-Path $taskWorkspace 'backgammon-tournaments-backend\tournaments'
    $env:E2E_GAME_FRONTEND = Join-Path $taskWorkspace 'Backgammon Game\frontend'
    $env:E2E_TOURNAMENT_FRONTEND = Join-Path $taskWorkspace 'backgammon-tournaments'
    $env:E2E_DICE_ROOT = Join-Path $taskWorkspace 'Backgammon Game\dice_service'
    foreach ($taskName in @('E2E_GAME_COMMIT', 'E2E_TOURNAMENT_COMMIT', 'E2E_UI_COMMIT')) {
        [Environment]::SetEnvironmentVariable($taskName, $null, 'Process')
    }
    $env:E2E_BROWSER = $Browser
    $env:E2E_HEADED = $(if ($Headed) { '1' } else { '0' })
    if ($GamePython) { $env:E2E_GAME_PYTHON = $GamePython }
    if ($TournamentPython) { $env:E2E_TOURNAMENT_PYTHON = $TournamentPython }
    if ($RedisExecutable) { $env:E2E_REDIS_EXE = $RedisExecutable }
    Write-Host "$Players players; $($Players / 2) first-round games together; $($Players - 1) natural wins required."
    Write-Host $(if ($RecoveryChecks) { 'Recovery checks enabled: delayed admission and same-room reentry.' } else { 'Normal play: no injected admission delays or reloads; actions wait for real acknowledgements.' })
    Write-Host 'No scenario timeout. Product clocks remain enabled. Ctrl+C stops this run.'
    Write-Host "Current local source; run-owned $Database databases; UI profile: $UiMode."
    Write-Host 'PostgreSQL uses the existing local cluster; work databases are never migrated or reset.'
    & $taskNode (Join-Path $PSScriptRoot 'run-e2e.mjs') $taskRunDir
    $taskExitCode = $LASTEXITCODE
} finally {
    foreach ($taskName in $taskEnvironmentNames) {
        [Environment]::SetEnvironmentVariable($taskName, $taskPreviousEnvironment[$taskName], 'Process')
    }
    if (Test-Path -LiteralPath $taskRunDir -PathType Container) {
        $taskShareDir = Join-Path $taskRunDir 'share-report'
        $taskFiles = @()
        if (Test-Path -LiteralPath $taskShareDir -PathType Container) {
            $taskFiles = @(Get-ChildItem -LiteralPath $taskShareDir -File -Recurse | ForEach-Object { $_.FullName })
        }
        # Do not include generated keys, configuration credentials or database files.
        if ($taskFiles.Count -gt 0) {
            $taskZipPath = $taskRunDir + '-report.zip'
            try {
                Compress-Archive -LiteralPath $taskShareDir -DestinationPath $taskZipPath -CompressionLevel Optimal
                Write-Host "SEND THIS FILE: $taskZipPath"
            } catch {
                Write-Host "REPORT PACKAGING FAILED: $($_.Exception.Message)"
                Write-Host "ARTIFACTS: $taskRunDir"
                $taskExitCode = 1
            }
        }
    }
}
exit $taskExitCode
