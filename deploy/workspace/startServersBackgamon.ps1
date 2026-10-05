param([switch]$Docker)

$ErrorActionPreference = "Stop"

if ($Docker) {
    & (Join-Path $PSScriptRoot 'startDockerBackgammon.ps1')
    exit $LASTEXITCODE
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$processes = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$launcherExitCode = 0

function Initialize-TournamentDatabase {
    if (-not (Test-Path -LiteralPath $tournamentsPython -PathType Leaf)) {
        throw "Tournament Python environment not found: $tournamentsPython"
    }

    # Inspect the same settings that the API and tournament worker will use.
    # Emit connection metadata only; never print the private password or secret key.
    $inspectDatabase = @'
import json
import os
from django.conf import settings
os.environ['DJANGO_SETTINGS_MODULE'] = 'tournaments.settings.development'
database = settings.DATABASES['default']
print(json.dumps({key: database.get(key, '') for key in ('ENGINE', 'HOST', 'PORT', 'NAME')}))
'@

    Push-Location -LiteralPath $tournamentsBackend
    try {
        $databaseJson = $inspectDatabase | & $tournamentsPython -
        if ($LASTEXITCODE -ne 0) {
            throw "Could not load the local tournament database settings."
        }
        $database = $databaseJson | ConvertFrom-Json

        if ($database.ENGINE -eq 'django.db.backends.postgresql') {
            $localPostgresData = Join-Path $root "backgammon-tournaments-backend\.local-postgresql\data\PG_VERSION"
            if (-not (Test-Path -LiteralPath $localPostgresData -PathType Leaf)) {
                throw "Project PostgreSQL is not initialized. Run deploy/setup_local_postgresql.py --isolated first."
            }
            if ($database.HOST -notin @('127.0.0.1', 'localhost')) {
                throw "The project PostgreSQL launcher requires an IPv4 loopback host."
            }

            $postgresPort = [int]$database.PORT
            Write-Host "[PostgreSQL] Starting project database $($database.NAME)..." -ForegroundColor Cyan
            & $tournamentsPython (Join-Path $root "backgammon-tournaments-backend\deploy\setup_local_postgresql.py") --isolated --start-only --port $postgresPort
            if ($LASTEXITCODE -ne 0) {
                throw "Local tournament PostgreSQL failed to start. See .local-postgresql/server.log."
            }
            if (-not (Wait-ForPort -Name "PostgreSQL" -HostName $database.HOST -Port $postgresPort)) {
                throw "Local tournament PostgreSQL is not reachable on the configured port."
            }
        }
        elseif ($database.ENGINE -in @('tournaments.db.backends.sqlite3', 'django.db.backends.sqlite3')) {
            Write-Host "[Tournaments Database] SQLite selected in local settings." -ForegroundColor Yellow
        }
        else {
            throw "Unexpected local tournament database engine: $($database.ENGINE)"
        }

        # Read-only: verify authentication and schema before launching applications.
        & $tournamentsPython manage.py migrate --check --settings=tournaments.settings.development
        if ($LASTEXITCODE -ne 0) {
            throw "Tournament database is not ready. Check the connection and apply pending migrations before restarting."
        }
        Write-Host "[Tournaments Database] Connection and migrations ready." -ForegroundColor Green
        Write-Host ""
    }
    finally {
        Pop-Location
    }
}

function Start-DevProcess {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$FilePath,
        [string[]]$Arguments
    )

    if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        Write-Host "[SKIP] $Name" -ForegroundColor Red
        Write-Host "       Directory not found:"
        Write-Host "       $WorkingDirectory"
        Write-Host ""
        return $null
    }

    if (
        ($FilePath.Contains("\") -or $FilePath.Contains("/")) -and
        -not (Test-Path -LiteralPath $FilePath -PathType Leaf)
    ) {
        Write-Host "[SKIP] $Name" -ForegroundColor Red
        Write-Host "       Executable not found:"
        Write-Host "       $FilePath"
        Write-Host ""
        return $null
    }

    try {
        Write-Host "[$Name] Starting..." -ForegroundColor Cyan

        $process = Start-Process `
            -FilePath $FilePath `
            -ArgumentList $Arguments `
            -WorkingDirectory $WorkingDirectory `
            -NoNewWindow `
            -PassThru

        $script:processes.Add($process)

        Write-Host "[$Name] Started - PID $($process.Id)" -ForegroundColor Green
        Write-Host ""

        return $process
    }
    catch {
        Write-Host "[$Name] FAILED" -ForegroundColor Red
        Write-Host $_.Exception.Message
        Write-Host ""
        return $null
    }
}

function Test-TcpPort {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$TimeoutMs = 500
    )

    $client = $null

    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $result = $client.BeginConnect($HostName, $Port, $null, $null)

        if (-not $result.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
            return $false
        }

        $client.EndConnect($result)
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($client) {
            $client.Close()
        }
    }
}

function Wait-ForPort {
    param(
        [string]$Name,
        [string]$HostName,
        [int]$Port,
        [int]$Attempts = 20,
        [int]$DelayMilliseconds = 250
    )

    for ($i = 1; $i -le $Attempts; $i++) {
        if (Test-TcpPort -HostName $HostName -Port $Port) {
            Write-Host "[$Name] Ready on ${HostName}:${Port}" -ForegroundColor Green
            Write-Host ""
            return $true
        }

        Start-Sleep -Milliseconds $DelayMilliseconds
    }

    Write-Host "[$Name] Port ${HostName}:${Port} did not become ready." -ForegroundColor Red
    Write-Host ""
    return $false
}

function Find-RedisExecutable {
    $candidates = @(
        (Join-Path $root "tools\redis\redis-server.exe"),
        "C:\Program Files\Redis\redis-server.exe",
        "C:\Program Files\Memurai\memurai.exe",
        "C:\Program Files\Memurai Developer\memurai.exe",
        "C:\ProgramData\chocolatey\bin\redis-server.exe",
        (Join-Path $HOME "scoop\apps\redis\current\redis-server.exe")
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    foreach ($commandName in @("redis-server.exe", "redis-server", "memurai.exe", "memurai")) {
        $command = Get-Command $commandName -ErrorAction SilentlyContinue

        if ($command -and $command.Source) {
            return $command.Source
        }
    }

    return $null
}

function Start-Redis {
    param(
        [string]$HostName,
        [int]$Port
    )

    if (Test-TcpPort -HostName $HostName -Port $Port) {
        Write-Host "[Redis] Already running on ${HostName}:${Port}" -ForegroundColor Green
        Write-Host ""
        return
    }

    $service = Get-Service -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match "redis|memurai" -or
            $_.DisplayName -match "redis|memurai"
        } |
        Select-Object -First 1

    if ($service) {
        Write-Host "[Redis] Found Windows service: $($service.Name)" -ForegroundColor Cyan

        if ($service.Status -ne "Running") {
            try {
                Start-Service -Name $service.Name
            }
            catch {
                Write-Host "[Redis] Could not start service $($service.Name)." -ForegroundColor Red
                Write-Host "        Try running this script as Administrator."
                Write-Host ""
            }
        }

        if (Wait-ForPort -Name "Redis" -HostName $HostName -Port $Port) {
            return
        }
    }

    $redisExe = Find-RedisExecutable

    if (-not $redisExe) {
        Write-Host "[Redis] No Windows Redis-compatible server was found." -ForegroundColor Red
        Write-Host ""
        Write-Host "Install Memurai or place redis-server.exe here:"
        Write-Host "  $root\tools\redis\redis-server.exe"
        Write-Host ""
        throw "Redis is required on ${HostName}:${Port}."
    }

    $redisWorkingDirectory = Split-Path -Parent $redisExe
    $redisFileName = [System.IO.Path]::GetFileName($redisExe).ToLowerInvariant()

    if ($redisFileName -like "memurai*") {
        Start-DevProcess `
            -Name "Redis" `
            -WorkingDirectory $redisWorkingDirectory `
            -FilePath $redisExe `
            -Arguments @()
    }
    else {
        Start-DevProcess `
            -Name "Redis" `
            -WorkingDirectory $redisWorkingDirectory `
            -FilePath $redisExe `
            -Arguments @(
                "--bind",
                $HostName,
                "--port",
                "$Port"
            )
    }

    if (-not (Wait-ForPort -Name "Redis" -HostName $HostName -Port $Port)) {
        throw "Redis process started, but ${HostName}:${Port} is not reachable."
    }
}


# ============================================================
# PATHS
# ============================================================

$gameFrontend = Join-Path $root "Backgammon Game\frontend"
$gameBackend = Join-Path $root "Backgammon Game\backend"
$diceService = Join-Path $root "Backgammon Game\dice_service"

$tournamentsFrontend = Join-Path $root "backgammon-tournaments"
$tournamentsBackend = Join-Path $root "backgammon-tournaments-backend\tournaments"
$adminFrontend = Join-Path $root "backgammon-tournaments-backend\admin-frontend"

$analysisService = Join-Path $root "backgammon-analysis-service"


# ============================================================
# PYTHON ENVIRONMENTS
# ============================================================

$gamePython = Join-Path $gameBackend ".venv\Scripts\python.exe"

$tournamentsPython = Join-Path $root `
    "backgammon-tournaments-backend\venv\Scripts\python.exe"

$analysisPython = Join-Path $analysisService `
    ".venv\Scripts\python.exe"


# ============================================================
# DEVELOPMENT HOSTS / PORTS
# ============================================================

$redisHost = "127.0.0.1"
$redisPort = 6379

$gameFrontendHost = "127.0.0.1"
$gameFrontendPort = 5173

$tournamentsFrontendHost = "127.0.0.1"
$tournamentsFrontendPort = 5174

$adminFrontendHost = "127.0.0.1"
$adminFrontendPort = 5175

$gameBackendHost = "127.0.0.1"
$gameBackendPort = 8000

$tournamentsBackendHost = "127.0.0.1"
$tournamentsBackendPort = 8001

$analysisHost = "127.0.0.1"
$analysisPort = 8002


Write-Host ""
Write-Host "============================================================"
Write-Host " Backgammon Development Environment"
Write-Host "============================================================"
Write-Host ""


try {

    # Verify the database before starting any application processes.
    Initialize-TournamentDatabase

    # ========================================================
    # REDIS
    # ========================================================

    Start-Redis `
        -HostName $redisHost `
        -Port $redisPort


    # ========================================================
    # GAME FRONTEND
    # ========================================================

    Start-DevProcess `
        -Name "Game Frontend" `
        -WorkingDirectory $gameFrontend `
        -FilePath $env:ComSpec `
        -Arguments @(
            "/d",
            "/s",
            "/c",
            "pnpm exec vite --host $gameFrontendHost --port $gameFrontendPort --strictPort"
        )


    # ========================================================
    # GAME BACKEND
    # ========================================================

    Start-DevProcess `
        -Name "Game Backend" `
        -WorkingDirectory $gameBackend `
        -FilePath $gamePython `
        -Arguments @(
            "manage.py",
            "runserver",
            "${gameBackendHost}:${gameBackendPort}"
        )


    # ========================================================
    # DICE SERVICE
    # ========================================================

    Start-DevProcess `
        -Name "Dice Service" `
        -WorkingDirectory $diceService `
        -FilePath $env:ComSpec `
        -Arguments @(
            "/d",
            "/s",
            "/c",
            "mix run --no-halt"
        )


# ============================================================
# GAME TASK WORKER
# ============================================================

Start-DevProcess `
    -Name "Game Task Worker" `
    -WorkingDirectory $gameBackend `
    -FilePath $gamePython `
    -Arguments @(
        "manage.py",
        "run_tasks_worker",
        "--interval",
        "5",
        "--limit",
        "50"
    )

    # ========================================================
    # TOURNAMENTS FRONTEND
    # ========================================================

    Start-DevProcess `
        -Name "Tournaments Frontend" `
        -WorkingDirectory $tournamentsFrontend `
        -FilePath $env:ComSpec `
        -Arguments @(
            "/d",
            "/s",
            "/c",
            "pnpm exec vite --host $tournamentsFrontendHost --port $tournamentsFrontendPort --strictPort"
        )


    # ========================================================
    # TOURNAMENTS BACKEND
    # ========================================================

    Start-DevProcess `
        -Name "Tournaments Backend" `
        -WorkingDirectory $tournamentsBackend `
        -FilePath $tournamentsPython `
        -Arguments @(
            "manage.py",
            "runserver",
            "${tournamentsBackendHost}:${tournamentsBackendPort}",
            "--settings=tournaments.settings.development"
        )

    Start-DevProcess `
        -Name "Tournaments Task Worker" `
        -WorkingDirectory $tournamentsBackend `
        -FilePath $tournamentsPython `
        -Arguments @(
            "manage.py",
            "run_tasks_worker",
            "--interval",
            "5",
            "--limit",
            "50",
            "--settings=tournaments.settings.development"
        )

    # ========================================================
    # ANALYSIS SERVICE
    # ========================================================

    Start-DevProcess `
        -Name "Analysis Service" `
        -WorkingDirectory $analysisService `
        -FilePath $analysisPython `
        -Arguments @(
            "manage.py",
            "runserver",
            "${analysisHost}:${analysisPort}"
        )


    if ($processes.Count -eq 0) {
        Write-Host "No services were started." -ForegroundColor Red
        exit 1
    }


    # ============================================================
# ANALYSIS WORKER
# ============================================================

Start-DevProcess `
    -Name "Analysis Worker" `
    -WorkingDirectory $analysisService `
    -FilePath $analysisPython `
    -Arguments @(
        "manage.py",
        "process_analyses"
    )


    Write-Host ""
    Write-Host "============================================================"
    Write-Host " Services launched - check logs for readiness"
    Write-Host "============================================================"
    Write-Host ""

    Write-Host " Redis:               redis://${redisHost}:${redisPort}"
    Write-Host ""
    Write-Host " Game Frontend:       http://${gameFrontendHost}:${gameFrontendPort}"
    Write-Host " Tournaments:         http://${tournamentsFrontendHost}:${tournamentsFrontendPort}/tournaments/"
    Write-Host " Admin Frontend:      http://${adminFrontendHost}:${adminFrontendPort}"
    Write-Host ""
    Write-Host " Game Backend:        http://${gameBackendHost}:${gameBackendPort}"
    Write-Host " Tournaments Backend: http://${tournamentsBackendHost}:${tournamentsBackendPort}"
    Write-Host " Analysis Service:    http://${analysisHost}:${analysisPort}"
    Write-Host ""
    Write-Host " ALL LOGS WILL APPEAR IN THIS WINDOW."
    Write-Host ""
    Write-Host " Press Ctrl+C to stop application services."
    Write-Host " Project PostgreSQL stays running for the next launch."
    Write-Host "============================================================"
    Write-Host ""


    $reportedExited = @{}

    while ($true) {

        $alive = 0

        foreach ($process in $processes) {

            $process.Refresh()

            if ($process.HasExited) {

                if (-not $reportedExited.ContainsKey($process.Id)) {
                    Write-Host ""
                    Write-Host "[PROCESS EXITED] PID $($process.Id) - Exit code $($process.ExitCode)" `
                        -ForegroundColor Yellow

                    $reportedExited[$process.Id] = $true
                }

            }
            else {
                $alive++
            }
        }

        if ($alive -eq 0) {
            break
        }

        Start-Sleep -Milliseconds 500
    }
}
catch {
    $launcherExitCode = 1
    Write-Host "[FAILED] $($_.Exception.Message)" -ForegroundColor Red
}
finally {

    Write-Host ""
    Write-Host "Stopping Backgammon services..." -ForegroundColor Yellow

    foreach ($process in $processes) {

        try {
            $process.Refresh()

            if (-not $process.HasExited) {

                & taskkill.exe `
                    /PID $process.Id `
                    /T `
                    /F `
                    2>$null | Out-Null
            }
        }
        catch {
        }
    }

    Write-Host "All services stopped." -ForegroundColor Green
}

exit $launcherExitCode
