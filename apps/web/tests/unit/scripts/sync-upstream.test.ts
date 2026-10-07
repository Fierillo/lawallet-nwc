// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const script = resolve('../../scripts/sync-upstream.sh')
const roots: string[] = []
const branch = 'automation/sync-upstream'

function fixture() {
  mkdirSync('/tmp/opencode', { recursive: true })
  const root = mkdtempSync('/tmp/opencode/sync-upstream-test-')
  roots.push(root)
  const upstream = join(root, 'upstream')
  const origin = join(root, 'origin.git')
  const fork = join(root, 'fork')
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.test',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.test'
  }
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  git(root, 'init', '-b', 'main', upstream)
  writeFileSync(join(upstream, 'shared.txt'), 'initial\n')
  git(upstream, 'add', 'shared.txt')
  git(upstream, 'commit', '-m', 'Initial')
  git(root, 'clone', '--bare', upstream, origin)
  git(root, 'clone', origin, fork)
  const commit = (cwd: string, file: string, text: string) => {
    writeFileSync(join(cwd, file), text)
    git(cwd, 'add', file)
    git(cwd, 'commit', '-m', `Update ${file}`)
    return git(cwd, 'rev-parse', 'HEAD')
  }
  const run = () =>
    spawnSync('bash', [script], {
      cwd: fork,
      env: {
        ...env,
        UPSTREAM_URL: upstream,
        SYNC_BRANCH: branch,
        BASE_BRANCH: 'main'
      },
      encoding: 'utf8'
    })
  return { root, upstream, origin, fork, git, commit, run }
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

it('pushes a merge branch preserving fork commits without changing origin/main', () => {
  const f = fixture()
  const custom = f.commit(f.fork, 'custom.txt', 'fork customization\n')
  f.git(f.fork, 'push', 'origin', 'main')
  const upstream = f.commit(f.upstream, 'feature.txt', 'upstream feature\n')
  const result = f.run()
  expect(result.status, result.stderr).toBe(0)
  expect(f.git(f.origin, 'rev-parse', 'main')).toBe(custom)
  expect(f.git(f.origin, 'show', `${branch}:custom.txt`)).toBe(
    'fork customization'
  )
  expect(f.git(f.origin, 'show', `${branch}:feature.txt`)).toBe(
    'upstream feature'
  )
  f.git(f.fork, 'merge-base', '--is-ancestor', custom, `origin/${branch}`)
  f.git(f.fork, 'merge-base', '--is-ancestor', upstream, `origin/${branch}`)
  expect(readFileSync(join(f.fork, 'custom.txt'), 'utf8')).toBe(
    'fork customization\n'
  )
})

it('does not publish anything when upstream is already included', () => {
  const f = fixture()
  expect(f.run().status).toBe(0)
  expect(f.git(f.origin, 'branch', '--list', branch)).toBe('')
})

it('aborts conflicts without changing any remote branch', () => {
  const f = fixture()
  const custom = f.commit(f.fork, 'shared.txt', 'fork version\n')
  f.git(f.fork, 'push', 'origin', 'main')
  f.commit(f.upstream, 'shared.txt', 'upstream version\n')
  const result = f.run()
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('shared.txt')
  expect(f.git(f.origin, 'rev-parse', 'main')).toBe(custom)
  expect(f.git(f.origin, 'branch', '--list', branch)).toBe('')
  expect(f.git(f.fork, 'status', '--porcelain')).toBe('')
})

it('updates the existing sync branch without rewriting history', () => {
  const f = fixture()
  f.commit(f.upstream, 'feature.txt', 'first upstream feature\n')
  expect(f.run().status).toBe(0)
  const previous = f.git(f.origin, 'rev-parse', branch)
  f.commit(f.upstream, 'second.txt', 'second upstream feature\n')
  const result = f.run()
  expect(result.status, result.stderr).toBe(0)
  f.git(f.fork, 'merge-base', '--is-ancestor', previous, `origin/${branch}`)
  expect(f.git(f.origin, 'show', `${branch}:second.txt`)).toBe(
    'second upstream feature'
  )
})
