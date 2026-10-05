import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export function sourceVersions(workspace, releaseFile) {
  const repositories = ['Backgammon Game', 'backgammon-tournaments',
    'backgammon-tournaments-backend', 'backgammon-analysis-service']
  const commands = new Map()
  const sources = repositories.map(name => {
    const directory = path.resolve(workspace, name)
    const git = (...args) => execFileSync('git', ['-c', `safe.directory=${directory.replaceAll('\\', '/')}`,
      '-C', directory, ...args], { encoding: 'utf8', windowsHide: true }).trim()
    commands.set(name, git)
    return { path: name, revision: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')) }
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
      if (source.dirty || (!sameRevision && !gameTreesMatch)) {
        throw new Error(`Release source mismatch or uncommitted files: ${source.path}`)
      }
      source.releaseRevision = expected
      source.comparison = sameRevision ? 'same_commit' : 'same_application_trees'
    }
  }
  return sources
}
