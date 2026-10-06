[CmdletBinding()]
param(
    [ValidateSet('prepare','finish','manual','status','restore-test')][string]$Action = 'prepare',
    [ValidateSet('device_push','mobile','direct_friend','ai_practice_fee','admin_refund_no_show','legacy_review')][string]$Check,
    [string]$Evidence,
    [string]$RunDirectory,
    [switch]$Headed
)
$ErrorActionPreference = 'Stop'
$taskDestination = 'administrator@38.247.146.17'
$taskRoot = '/home/dev/backgammon-project'
$taskRepository = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..\..')).Path
$taskGit = @('-c', "safe.directory=$($taskRepository.Replace('\','/'))", '-C', $taskRepository)
$taskRevision = (& git.exe @taskGit rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $taskRevision -notmatch '^[a-f0-9]{40}$') { throw 'Cannot identify the tool Git revision.' }
$taskDirty = & git.exe @taskGit status --porcelain --untracked-files=all
if ($LASTEXITCODE -ne 0 -or $taskDirty) { throw 'Commit and publish the approved tools before validation.' }
$taskRelease = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\..\release.json') -Raw | ConvertFrom-Json
$taskTag = [string]$taskRelease.image_tag
if ($taskTag -notmatch '^backgammon-[a-z0-9-]{1,36}$' -or $taskTag -eq 'bg-20261005-git-r2') { throw 'Expected a new candidate release tag.' }
$taskRemoteReport = "$taskRoot/reports/release-validation/$taskTag"
$taskWorkspace = Split-Path $taskRepository -Parent
$taskLocal = Join-Path $taskWorkspace "docs\release-validation\$taskTag"
if (-not (Test-Path -LiteralPath $taskLocal)) { New-Item -ItemType Directory -Path $taskLocal | Out-Null }
$taskAccount = (& whoami.exe).Trim()
& icacls.exe $taskLocal /inheritance:r /grant:r "${taskAccount}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect the private local validation directory.' }

function Invoke-ValidationServer([string]$Operation, [bool]$Install) {
    $taskPayload = @{ revision=$taskRevision; tag=$taskTag; action=$Operation; install=$Install; check=$Check; evidence=$Evidence }
    $taskPayload64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($taskPayload | ConvertTo-Json -Compress)))
    $taskProgram = @'
import base64, json, os, re, subprocess
from pathlib import Path
data = json.loads(base64.b64decode('PAYLOAD64'))
root = Path('/home/dev/backgammon-project')
tools = root / 'tools/backgammon-tool-source'
revision = data['revision']
if not re.fullmatch('[a-f0-9]{40}', revision) or tools.is_symlink() or not (tools / '.git').is_file():
    raise ValueError('Expected the existing dedicated tool worktree and a published revision')
subprocess.run(['sudo', '-v'], check=True)
git = ['sudo', 'git', '-c', 'safe.directory=' + str(tools), '-C', str(tools)]
top = subprocess.check_output(git + ['rev-parse', '--show-toplevel'], text=True).strip()
if Path(top).resolve() != tools or subprocess.check_output(git + ['status', '--porcelain', '--untracked-files=all'], text=True).strip():
    raise ValueError('The permanent tool worktree is different or has local changes')
if data['install']:
    subprocess.run(git + ['fetch', 'origin', revision], check=True)
    subprocess.run(git + ['checkout', '--detach', revision], check=True)
    subprocess.run(git + ['sparse-checkout', 'set', 'deploy/workspace'], check=True)
if subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip() != revision:
    raise ValueError('Server tools differ; run preparation from the matching local commit')
workspace = tools / 'deploy/workspace'
release = json.loads((workspace / 'release.json').read_text())
if release['image_tag'] != data['tag']:
    raise ValueError('Server and local release tags differ')
os.umask(0o077)
command = ['python3', str(workspace / 'docker/validate_release.py'), data['action']]
if data['action'] == 'manual':
    command += ['--check', data.get('check') or '', '--evidence', data.get('evidence') or '']
subprocess.run(command, check=True)
'@
    $taskProgram = $taskProgram.Replace('PAYLOAD64', $taskPayload64)
    $taskEncoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($taskProgram))
    & ssh.exe -t $taskDestination "printf %s $taskEncoded | base64 --decode | python3" | Out-Host
    return $LASTEXITCODE
}
function Receive-ValidationFile([string]$Name) {
    & scp.exe "${taskDestination}:${taskRemoteReport}/$Name" (Join-Path $taskLocal $Name)
    if ($LASTEXITCODE -ne 0) { throw "Cannot download the preserved validation artifact: $Name" }
}
$taskExit = 1
$taskServerStarted = $false
$taskFailure = $null
try {
    if ($Action -ne 'prepare') {
        $taskServerStarted = $true
        $taskExit = Invoke-ValidationServer $Action $false
    } else {
        & node.exe --test (Join-Path $PSScriptRoot 'destination-policy.test.mjs') (Join-Path $PSScriptRoot 'source-versions_test.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Local runner policy tests failed; server preparation was not started.' }
        $taskServerStarted = $true
        $taskExit = Invoke-ValidationServer 'prepare' $true
        if ($taskExit -ne 0) { throw 'Server preparation failed. The saved report identifies the failed stage.' }
        Receive-ValidationFile 'client-location.json'
        $taskLocation = Get-Content -LiteralPath (Join-Path $taskLocal 'client-location.json') -Raw | ConvertFrom-Json
        $taskId = [string]$taskLocation.validation_id
        $taskExpectedManifest = "$taskRoot/backups/backgammon-backups/validation-$taskId/docker-rehearsal/browser-e2e-r2/server-client.json"
        if ($taskId -notmatch '^[a-f0-9]{32}$' -or $taskLocation.manifest -ne $taskExpectedManifest) { throw 'Unexpected candidate manifest path.' }
        $taskManifest = Join-Path $taskLocal 'server-client.json'
        & scp.exe "${taskDestination}:$taskExpectedManifest" $taskManifest
        if ($LASTEXITCODE -ne 0) { throw 'Candidate manifest download failed.' }
        $taskManifestValue = Get-Content -LiteralPath $taskManifest -Raw | ConvertFrom-Json
        if ($taskManifestValue.identity.validation_id -ne $taskId -or $taskManifestValue.identity.infrastructure_revision -ne $taskRevision) { throw 'Downloaded manifest belongs to different sources.' }
        $taskReceipt = Join-Path $taskLocal 'browser-run.json'
        if (-not $RunDirectory -and (Test-Path -LiteralPath $taskReceipt)) {
            $taskSaved = Get-Content -LiteralPath $taskReceipt -Raw | ConvertFrom-Json
            if ($taskSaved.session_id -ne $taskLocation.session_id) { throw 'Saved browser run belongs to another session.' }
            $RunDirectory = [string]$taskSaved.directory
        }
        $taskRuns = Join-Path $taskWorkspace 'docs\tournament-e2e-integrations\runs'
        if (-not $RunDirectory) {
            $taskExisting = @(Get-ChildItem -LiteralPath $taskRuns -Directory -ErrorAction SilentlyContinue | ForEach-Object Name)
            $taskArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File', (Join-Path $PSScriptRoot 'run-remote-tournament-e2e.ps1'), '-ServerManifest', $taskManifest, '-Players','16','-Comprehensive','-ValidationId',$taskId)
            if ($Headed) { $taskArgs += '-Headed' }
            & powershell.exe @taskArgs
            $taskBrowserExit = $LASTEXITCODE
            $taskNew = @(Get-ChildItem -LiteralPath $taskRuns -Directory | Where-Object { $_.Name -notin $taskExisting })
            if ($taskNew.Count -ne 1) { throw 'Could not identify one candidate browser run; no new server baseline was created.' }
            $RunDirectory = $taskNew[0].FullName
        } else {
            $taskBrowserExit = 0
        }
        $taskRun = (Resolve-Path -LiteralPath $RunDirectory).Path
        $taskResult = Get-Content -LiteralPath (Join-Path $taskRun 'run-summary.json') -Raw | ConvertFrom-Json
        if ($taskResult.targetSession -ne $taskLocation.session_id -or $taskResult.runId -notmatch '^[A-Za-z0-9_-]{10,80}$' -or
            $taskRun -ne [IO.Path]::GetFullPath((Join-Path $taskRuns $taskResult.runId))) { throw 'Browser evidence is outside the candidate run directory/session.' }
        [IO.File]::WriteAllText($taskReceipt, (@{directory=$taskRun; session_id=$taskLocation.session_id} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
        & scp.exe (Join-Path $taskRun 'run-summary.json') "${taskDestination}:${taskRemoteReport}/browser-result.json"
        if ($LASTEXITCODE -ne 0) { throw 'Combined browser report upload failed.' }
        $taskExit = Invoke-ValidationServer 'finish' $false
        if ($taskBrowserExit -ne 0) { $taskExit = 1 }
    }
} catch {
    $taskFailure = $_
    throw
} finally {
    if ($taskServerStarted) {
        try {
            Receive-ValidationFile 'report.json'
            $taskFinal = Get-Content -LiteralPath (Join-Path $taskLocal 'report.json') -Raw | ConvertFrom-Json
            if ($taskFinal.identity.infrastructure_revision -ne $taskRevision -or $taskFinal.identity.release.image_tag -ne $taskTag) { throw 'Final report belongs to another immutable candidate.' }
            Write-Host "ONE VALIDATION REPORT: $(Join-Path $taskLocal 'report.json')"
            Write-Host "All checks accepted: $($taskFinal.passed); production cutover performed: $($taskFinal.cutover_performed)"
        } catch {
            if ($taskFailure) { Write-Warning "Final report collection also failed: $($_.Exception.Message)" }
            else { throw }
        }
    }
}
exit $taskExit
