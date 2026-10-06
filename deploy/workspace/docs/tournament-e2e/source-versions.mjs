import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repositories = ['Backgammon Game', 'backgammon-tournaments',
  'backgammon-tournaments-backend', 'backgammon-analysis-service']

export function verifiedHarnessStatus(status, files) {
  const prefix = 'deploy/workspace/docs/tournament-e2e/'
  return Boolean(status) && status.split('\n').every(line => {
    const file = line.slice(3)
    return !line.slice(0, 2).includes('D') && !line.slice(0, 2).includes('R')
      && file.startsWith(prefix) && files.includes(file.slice(prefix.length))
  })
}

export function sourceVersions(workspace, releaseFile, verifiedHarnessFiles = []) {
  const commands = new Map()
  const sources = repositories.map(name => {
    const directory = path.resolve(workspace, name)
    const git = (...args) => execFileSync('git', ['-c', `safe.directory=${directory.replaceAll('\\', '/')}`,
      '-C', directory, ...args], { encoding: 'utf8', windowsHide: true }).trimEnd()
    commands.set(name, git)
    const status = git('status', '--porcelain', '--untracked-files=all')
    // The remote runner has already matched these exact tool bytes to the live
    // manifest hash. Application edits and other infrastructure edits still fail.
    const onlyVerifiedHarnessChanges = name === 'Backgammon Game' && verifiedHarnessStatus(status, verifiedHarnessFiles)
    return { path: name, revision: git('rev-parse', 'HEAD'), dirty: Boolean(status),
      verifiedHarnessChanges: onlyVerifiedHarnessChanges }
  })
  if (releaseFile) {
    const release = JSON.parse(fs.readFileSync(releaseFile, 'utf8'))
    if (release.schema_version !== 1 || release.sources?.length !== repositories.length
      || new Set(release.sources.map(source => source.path)).size !== repositories.length) {
      throw new Error('Expected the public pinned release.json with four source repositories')
    }
    for (const source of sources) {
      const expected = release.sources.find(item => item.path === source.path)?.revision
      if (!/^[a-f0-9]{40}$/.test(expected || '')) throw new Error('Missing full release source revision')
      const sameRevision = source.revision === expected
      // Bootstrap infrastructure commits live in the game repository. Compare
      // all three application trees when only its deployment commit differs.
      const gameTreesMatch = source.path === 'Backgammon Game' && ['backend', 'frontend', 'dice_service']
        .every(tree => commands.get(source.path)('rev-parse', `${expected}:${tree}`)
          === commands.get(source.path)('rev-parse', `HEAD:${tree}`))
      if ((source.dirty && !source.verifiedHarnessChanges) || (!sameRevision && !gameTreesMatch)) {
        throw new Error(`Release source mismatch or uncommitted files: ${source.path}`)
      }
      source.releaseRevision = expected
      source.comparison = sameRevision ? 'same_commit' : 'same_application_trees'
    }
  }
  return sources
}
export function findWorkspace(toolsDirectory) {
  let directory = path.resolve(toolsDirectory)
  while (true) {
    if (repositories.every(name => fs.existsSync(path.join(directory, name)) &&
        fs.statSync(path.join(directory, name)).isDirectory())) return directory
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error('Cannot find the workspace containing all four application repositories.')
    directory = parent
  }
}
