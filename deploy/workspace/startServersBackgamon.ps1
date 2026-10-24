param(
    [ValidateSet('up', 'stop', 'status', 'logs')]
    [string]$Action = 'up',
    [switch]$SkipBuild,
    # Compatibility with existing shortcuts; Docker is now always used.
    [switch]$Docker
)

$ErrorActionPreference = 'Stop'

try {
    # Support both the workspace launcher and its source under deploy/workspace.
    $candidates = @(
        $PSScriptRoot
        [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
    )
    $applications = @(
        'Backgammon Game'
        'backgammon-tournaments-backend'
        'backgammon-tournaments'
        'backgammon-analysis-service'
    )
    $workspaceRoot = $null
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath (Join-Path $candidate 'docker\compose.local.yaml') -PathType Leaf) -or
            -not (Test-Path -LiteralPath (Join-Path $candidate 'startDockerBackgammon.ps1') -PathType Leaf)) {
            continue
        }
        $complete = $true
        foreach ($application in $applications) {
            if (-not (Test-Path -LiteralPath (Join-Path $candidate $application) -PathType Container)) {
                $complete = $false
                break
            }
        }
        if ($complete) {
            $workspaceRoot = $candidate
            break
        }
    }
    if (-not $workspaceRoot) {
        throw 'Backgammon workspace not found. Keep the four application folders and docker/compose.local.yaml together.'
    }

    & (Join-Path $workspaceRoot 'startDockerBackgammon.ps1') -Action $Action -SkipBuild:$SkipBuild
    exit $LASTEXITCODE
}
catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
