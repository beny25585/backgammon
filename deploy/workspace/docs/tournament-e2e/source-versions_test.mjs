import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findWorkspace, verifiedHarnessStatus } from './source-versions.mjs'

test('canonical tools and the legacy launcher resolve the same four-repository workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'backgammon-workspace-'))
  try {
    for (const name of ['Backgammon Game', 'backgammon-tournaments',
      'backgammon-tournaments-backend', 'backgammon-analysis-service']) {
      fs.mkdirSync(path.join(workspace, name))
    }
    for (const relative of ['Backgammon Game/deploy/workspace/docs/tournament-e2e', 'docs/tournament-e2e-integrations']) {
      const tools = path.join(workspace, relative)
      fs.mkdirSync(tools, { recursive: true })
      assert.equal(findWorkspace(tools), workspace)
    }
  } finally { fs.rmSync(workspace, { recursive: true, force: true }) }
})

test('an incomplete workspace is rejected', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backgammon-incomplete-'))
  try { assert.throws(() => findWorkspace(directory), /all four application repositories/) }
  finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('exactly hashed harness edits are allowed while application edits remain blocked', () => {
  const files = ['rehearsal_runtime.py', 'source-versions.mjs']
  assert.equal(verifiedHarnessStatus(' M deploy/workspace/docs/tournament-e2e/source-versions.mjs\n?? deploy/workspace/docs/tournament-e2e/rehearsal_runtime.py', files), true)
  for (const status of [' M backend/game/tasks.py', ' M frontend/src/App.tsx',
    ' M deploy/workspace/docker/compose.production.yaml',
    ' M deploy/workspace/docs/tournament-e2e/unverified.py',
    ' D deploy/workspace/docs/tournament-e2e/rehearsal_runtime.py',
    'R  old.py -> deploy/workspace/docs/tournament-e2e/rehearsal_runtime.py',
    ' M deploy/workspace/docs/tournament-e2e/rehearsal_runtime.py\n M backend/game/tasks.py']) {
    assert.equal(verifiedHarnessStatus(status, files), false, status)
  }
})
