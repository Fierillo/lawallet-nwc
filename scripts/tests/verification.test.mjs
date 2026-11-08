import { databaseEnvironment } from '../database-environment.mjs'
import { readdirSync } from 'node:fs'
import { coverageGaps } from '../test-coverage-gaps.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  planVerification,
  collectChanges,
  runPlan
} from '../verification-plan.mjs'
const changes = files => ({ files, deleted: [], baseSha: 'explicit-base' })
test('requires an explicit base and known mode', () => {
  assert.throws(() => planVerification('dev', changes([])), /base/)
  assert.throws(() => planVerification('typo', changes([]), 'main'), /mode/)
})
test('no changes still runs critical flows and orchestration contracts', () => {
  const plan = planVerification('dev', changes([]), 'main')
  assert.ok(plan.some(p => p.name === 'critical'))
  assert.ok(plan.some(p => p.name === 'harness'))
})
test('web changes run affected sources and changed tests without empty-success flags', () => {
  const plan = planVerification(
    'dev',
    changes(['apps/web/lib/client/pay.ts', 'apps/web/tests/unit/pay.test.ts']),
    'main'
  )
  assert.ok(
    plan.some(
      p => p.name === 'affected' && p.args.includes('lib/client/pay.ts')
    )
  )
  assert.ok(
    plan.some(
      p =>
        p.name === 'changed-tests' && p.args.includes('tests/unit/pay.test.ts')
    )
  )
  assert.ok(plan.every(p => !p.args.includes('--passWithNoTests')))
})
for (const file of [
  'pnpm-lock.yaml',
  'package.json',
  'packages/shared/src/schemas.ts',
  'apps/web/vitest.config.ts',
  'apps/web/tsconfig.json',
  'apps/web/prisma/schema.prisma',
  'scripts/check.mjs',
  '.github/workflows/ci.yml',
  'unknown.txt'
]) {
  test(`transversal/unknown ${file} falls back to full`, () => {
    assert.ok(
      planVerification('dev', changes([file]), 'main').some(
        p => p.name === 'full-tests-typecheck'
      )
    )
  })
}
test('deleted paths trigger full, docs-only keeps critical plus docs', () => {
  assert.ok(
    planVerification(
      'dev',
      {
        ...changes(['apps/web/lib/removed.ts']),
        deleted: ['apps/web/lib/removed.ts']
      },
      'main'
    ).some(p => p.name === 'full-tests-typecheck')
  )
  const docs = planVerification('dev', changes(['README.md']), 'main')
  assert.ok(docs.some(p => p.name === 'critical'))
  assert.ok(docs.some(p => p.name === 'docs'))
})
test('pre-main always executes full, database, compatibility, docs and build', () => {
  const p = planVerification('pre-main', changes([]), 'main')
  for (const name of [
    'harness',
    'migration-review',
    'full-tests-typecheck',
    'database',
    'build',
    'docs'
  ])
    assert.ok(
      p.some(s => s.name === name),
      name
    )
})
test('orchestration executes in order and stops on any nonzero status', context => {
  context.mock.method(console, 'log', () => {})
  const seen = []
  const plan = [
    { name: 'first', command: 'x', args: [] },
    { name: 'second', command: 'x', args: [] }
  ]
  assert.throws(
    () =>
      runPlan(plan, s => {
        seen.push(s.name)
        return 1
      }),
    /first/
  )
  assert.deepEqual(seen, ['first'])
  assert.throws(() => runPlan([], () => 0), /empty/)
})
test('real git inventory includes committed, staged, unstaged and untracked paths; rejects missing bases', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'walletilla-selection-'))
  const git = (...args) =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  try {
    git('init')
    git('config', 'user.name', 'test')
    git('config', 'user.email', 'test@example.invalid')
    writeFileSync(join(cwd, 'base.txt'), 'base')
    writeFileSync(join(cwd, 'cancelled.txt'), 'base')
    git('add', 'base.txt', 'cancelled.txt')
    git('commit', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    writeFileSync(join(cwd, 'committed.txt'), 'one')
    git('add', 'committed.txt')
    git('commit', '-m', 'change')
    writeFileSync(join(cwd, 'staged.txt'), 'two')
    git('add', 'staged.txt')
    writeFileSync(join(cwd, 'base.txt'), 'unstaged')
    // A staged edit followed by an unstaged inverse must still be selected.
    writeFileSync(join(cwd, 'cancelled.txt'), 'staged')
    git('add', 'cancelled.txt')
    writeFileSync(join(cwd, 'cancelled.txt'), 'base')
    mkdirSync(join(cwd, 'new dir'))
    writeFileSync(join(cwd, 'new dir', 'untracked.test.ts'), 'three')
    assert.deepEqual(
      collectChanges(base, cwd).files.sort(),
      [
        'base.txt',
        'cancelled.txt',
        'committed.txt',
        'new dir/untracked.test.ts',
        'staged.txt'
      ].sort()
    )
    assert.throws(() => collectChanges('does-not-exist', cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('the real Vitest runner rejects an empty selected suite', () => {
  let failure
  try {
    execFileSync(
      'pnpm',
      [
        '--filter',
        '@lawallet-nwc/web',
        'exec',
        'vitest',
        'run',
        'tests/critical-flows/__nonexistent_contract__.test.ts'
      ],
      { encoding: 'utf8', stdio: 'pipe' }
    )
  } catch (error) {
    failure = error
  }
  assert.equal(failure?.status, 1)
  assert.match(
    String(failure?.stdout) + String(failure?.stderr),
    /No test files found/
  )
})

test('coverage cannot silently omit packages that only define a test script', () => {
  assert.deepEqual(
    coverageGaps([
      {
        name: 'web',
        scripts: { test: 'vitest', 'test:coverage': 'vitest --coverage' }
      },
      { name: 'node-only', scripts: { test: 'node --test' } },
      { name: 'future', scripts: { test: 'node --test' } },
      { name: 'no-tests', scripts: {} }
    ]),
    ['node-only', 'future']
  )
  const plan = planVerification('pre-main', changes([]), 'main')
  assert.ok(
    plan
      .find(p => p.name === 'full-tests-typecheck')
      .args.includes('test:coverage')
  )
  assert.ok(plan.some(p => p.name === 'uncovered-packages'))
})

test('real Vitest discovery assigns every test, including SQL, to exactly one responsibility', () => {
  const walk = dir =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : [join(dir, entry.name)]
    )
  const expected = walk('apps/web/tests')
    .filter(file => /\.test\.tsx?$/.test(file))
    .map(file => join(process.cwd(), file))
    .sort()
  const cases = [[], ['--config', 'vitest.database.config.ts']].flatMap(
    config =>
      JSON.parse(
        execFileSync(
          'pnpm',
          [
            '--filter',
            '@lawallet-nwc/web',
            'exec',
            'vitest',
            'list',
            '--filesOnly',
            '--json',
            ...config
          ],
          { encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }
        )
      )
  )
  const projects = new Map()
  for (const item of cases) {
    const owners = projects.get(item.file) || new Set()
    owners.add(item.projectName)
    projects.set(item.file, owners)
  }
  assert.deepEqual([...projects.keys()].sort(), expected)
  for (const [file, owners] of projects)
    assert.equal(owners.size, 1, `Duplicate projects for ${file}`)
})

test('full fallback executes SQL and shared test/database boundaries cannot be misrouted to ordinary Vitest', () => {
  for (const file of [
    'pnpm-lock.yaml',
    'apps/web/tests/database/recipient-ownership.test.ts',
    'apps/web/tests/helpers/test-database.ts',
    'apps/web/tests/critical-setup.ts'
  ]) {
    const plan = planVerification('dev', changes([file]), 'main')
    for (const phase of [
      'full-tests-typecheck',
      'migration-review',
      'database'
    ])
      assert.ok(
        plan.some(step => step.name === phase),
        `${file}: ${phase}`
      )
    assert.ok(!plan.some(step => step.name === 'changed-tests'), file)
  }
})

test('disposable SQL strips inherited libpq routing, services and password configuration', () => {
  const env = databaseEnvironment(
    {
      PATH: '/bin',
      PGHOSTADDR: '192.0.2.1',
      PGSERVICE: 'unconfigured-service',
      PGPASSWORD: 'synthetic-fixture',
      PGPASSFILE: '/untrusted',
      PGOPTIONS: '-c search_path=other',
      PGHOST: '/wrong',
      PGPORT: '1',
      PGDATABASE: 'wrong',
      PGUSER: 'wrong'
    },
    '/tmp/walletilla-verify-db-fixture',
    '/tools/pgsql/bin'
  )
  for (const key of ['PGHOSTADDR', 'PGSERVICE', 'PGPASSWORD', 'PGOPTIONS'])
    assert.equal(env[key], undefined, key)
  assert.equal(env.PGHOST, '/tmp/walletilla-verify-db-fixture')
  assert.equal(env.PGPORT, '5432')
  assert.equal(env.PGUSER, 'walletilla_test')
  assert.equal(env.PGDATABASE, 'postgres')
  assert.equal(env.PGPASSFILE, '/dev/null')
  assert.equal(env.PGSERVICEFILE, '/dev/null')
  assert.equal(env.PATH, '/bin')
})
