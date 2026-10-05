param(
    [ValidateSet('up', 'stop', 'status', 'logs')]
    [string]$Action = 'up',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$dockerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dockerComposeFile = Join-Path $dockerRoot 'docker\compose.local.yaml'
$composeArguments = @('compose', '-f', $dockerComposeFile)

function Invoke-ProjectCompose {
    param([string[]]$Arguments)
    & docker @composeArguments @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose failed (exit $LASTEXITCODE)."
    }
}

try {
    $dockerOperatingSystem = & docker info --format '{{.OSType}}'
    if ($LASTEXITCODE -ne 0 -or $dockerOperatingSystem -ne 'linux') {
        throw 'Start Docker Desktop with Linux containers, then retry.'
    }
    switch ($Action) {
        'up' {
            $privateDirectory = Join-Path $dockerRoot 'docker\.local'
            New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
            Invoke-ProjectCompose -Arguments @('config', '--quiet')
            if (-not $SkipBuild) {
                Invoke-ProjectCompose -Arguments @('build', 'game-api', 'tournaments-api', 'analysis-api', 'dice', 'game-frontend', 'tournaments-frontend', 'admin-frontend')
            }
            Invoke-ProjectCompose -Arguments @('--profile', 'setup', 'run', '--rm', '--no-deps', 'config-init')
            Invoke-ProjectCompose -Arguments @('up', '-d', '--wait', '--wait-timeout', '180')
            Invoke-ProjectCompose -Arguments @('exec', '-T', 'gateway', 'nginx', '-t')
            Invoke-ProjectCompose -Arguments @('exec', '-T', 'gateway', 'nginx', '-s', 'reload')
            Write-Host 'Docker environment: http://backgammon.localhost:8180/tournaments/' -ForegroundColor Green
            Write-Host 'Admin frontend: http://backgammon.localhost:8180/tournaments-admin/'
            Write-Host 'Create your user: docker compose -f docker/compose.local.yaml run --rm --no-deps tournaments-api python manage.py createsuperuser'
            Write-Host 'Stop containers without deleting data: .\startDockerBackgammon.ps1 -Action stop'
        }
        'stop' { Invoke-ProjectCompose -Arguments @('stop') }
        'status' { Invoke-ProjectCompose -Arguments @('ps', '--all') }
        'logs' { Invoke-ProjectCompose -Arguments @('logs', '--follow', '--tail', '100') }
    }
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
exit 0
