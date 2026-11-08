import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function collectChanges(base, cwd = process.cwd()) {
  if (!base) throw new Error('An explicit --base is required')
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  const baseSha = git(
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${base}^{commit}`
  ).trim()
  const split = value => value.split('\0').filter(Boolean)
  // Review both branch commits and the entire working index/tree, including new
  // tests not staged yet. NUL records preserve spaces and unusual filenames.
  const files = [
    ...new Set([
      ...split(git('diff', '--name-only', '-z', `${baseSha}...HEAD`, '--')),
      ...split(git('diff', '--cached', '--name-only', '-z', '--')),
      ...split(git('diff', '--name-only', '-z', '--')),
      ...split(git('ls-files', '--others', '--exclude-standard', '-z'))
    ])
  ].sort()
  return {
    baseSha,
    files,
    deleted: files.filter(file => !existsSync(join(cwd, file)))
  }
}

const web = ['--filter', '@lawallet-nwc/web', 'exec', 'vitest']
const step = (name, ...args) => ({ name, command: 'pnpm', args })
export function planVerification(mode, changes, base) {
  if (!base) throw new Error('An explicit base is required')
  if (!['dev', 'pre-main'].includes(mode))
    throw new Error('Unknown verification mode')
  const files = changes.files
  const docs = file => /\.(md|mdx)$/.test(file) || file.startsWith('apps/docs/')
  const transversal = file =>
    !docs(file) &&
    (!file.startsWith('apps/web/') ||
      /(?:^|\/)(?:[^/]*config[^/]*|package\.json)$/.test(file) ||
      file.startsWith('apps/web/prisma/') ||
      file.startsWith('apps/web/tests/database/') ||
      file.startsWith('apps/web/tests/helpers/') ||
      /^apps\/web\/tests\/[^/]*setup\.tsx?$/.test(file) ||
      file.startsWith('apps/web/lib/auth/') ||
      file === 'apps/web/components/admin/auth-context.tsx' ||
      /apps\/web\/lib\/(?:nip98|jwt|public-url)/.test(file) ||
      !/\.(ts|tsx)$/.test(file))
  const full =
    mode === 'pre-main' || changes.deleted.length > 0 || files.some(transversal)
  const plan = [step('harness', 'test:harness')]
  if (full)
    plan.push({
      name: 'migration-review',
      command: process.execPath,
      args: ['scripts/check-migrations.mjs', '--base', base]
    })
  if (full) {
    plan.push(
      step(
        'full-tests-typecheck',
        'exec',
        'turbo',
        'run',
        mode === 'pre-main' ? 'test:coverage' : 'test',
        'typecheck',
        '--force'
      )
    )
    if (mode === 'pre-main')
      plan.push({
        name: 'uncovered-packages',
        command: process.execPath,
        args: ['scripts/test-coverage-gaps.mjs']
      })
  } else {
    plan.push(
      step(
        'critical',
        ...web,
        'run',
        'tests/critical-flows',
        'tests/unit/lib/nip98-preview-origin.test.ts',
        'tests/integration/api/saved-recipients.test.ts'
      )
    )
    const candidates = files
      .filter(file => file.startsWith('apps/web/') && /\.tsx?$/.test(file))
      .map(file => file.slice('apps/web/'.length))
    const tests = candidates.filter(file => /\.test\.tsx?$/.test(file))
    const sources = candidates.filter(file => !tests.includes(file))
    if (tests.length) plan.push(step('changed-tests', ...web, 'run', ...tests))
    if (sources.length)
      plan.push(step('affected', ...web, 'related', ...sources, '--run'))
  }
  if (full) {
    plan.push({
      name: 'database',
      command: process.execPath,
      args: ['scripts/verify-database.mjs', '--base', base]
    })
    if (mode === 'pre-main')
      plan.push({
        ...step('build', 'build'),
        env: { SKIP_ENV_VALIDATION: '1' }
      })
  }
  if (mode === 'pre-main' || files.some(docs))
    plan.push(step('docs', 'docs:check'))
  return plan
}
export function runPlan(plan, execute) {
  if (!plan.length) throw new Error('Refusing an empty verification plan')
  for (const phase of plan) {
    const start = performance.now()
    console.log(
      `\n[verify] ${phase.name}: ${phase.command} ${phase.args.join(' ')}`
    )
    const status = execute(phase)
    console.log(
      `[verify] ${phase.name}: exit=${status}, ${((performance.now() - start) / 1000).toFixed(2)}s`
    )
    if (status !== 0)
      throw new Error(`Verification failed at ${phase.name} (exit ${status})`)
  }
}
