[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ServerManifest,
    [ValidateSet(16,32)][int]$Players = 16,
    [ValidateSet('chrome','msedge','chromium')][string]$Browser = 'chrome',
    [switch]$Headed
)
$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskPreviousBrowser = $env:E2E_BROWSER
$taskPreviousHeaded = $env:E2E_HEADED
$taskExitCode = 1
try {
    $env:E2E_BROWSER = $Browser
    $env:E2E_HEADED = $(if ($Headed) { '1' } else { '0' })
    & $taskNode (Join-Path $PSScriptRoot 'run-remote-e2e.mjs') (Resolve-Path -LiteralPath $ServerManifest).Path ([string]$Players)
    $taskExitCode = $LASTEXITCODE
} finally {
    $env:E2E_BROWSER = $taskPreviousBrowser
    $env:E2E_HEADED = $taskPreviousHeaded
}
exit $taskExitCode
