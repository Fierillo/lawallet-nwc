import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
export const migrationRoot = 'apps/web/prisma/migrations'
// Conservative tripwire, NOT a SQL parser or a human security review. Width
// changes are checked against a real PostgreSQL schema by the database phase.
export function validateNewMigration(sql) {
  const statements = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
  if (!statements.length) throw new Error('Empty migration requires review')
  for (const s of statements) {
    const allowed =
      /^CREATE (?:TABLE|(?:UNIQUE )?INDEX)\b/i.test(s) ||
      /^ALTER TABLE "[^"]+" ADD (?:COLUMN|CONSTRAINT)\b/i.test(s) ||
      /^ALTER TABLE "[^"]+" ALTER COLUMN "[^"]+" TYPE VARCHAR\(\d+\)$/i.test(s)
    if (
      !allowed ||
      /\b(?:DROP|TRUNCATE|DELETE|UPDATE|USING)\b/i.test(
        s.replace(/ON (?:DELETE|UPDATE) CASCADE/gi, '')
      ) ||
      /ADD COLUMN[\s\S]*NOT NULL/i.test(s)
    )
      throw new Error(
        'Non-additive or unrecognized SQL requires explicit human review'
      )
  }
}
export function inspectMigrations(base, cwd = process.cwd()) {
  if (!base) throw new Error('Explicit migration base required')
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  const sha = git(
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${base}^{commit}`
  ).trim()
  const previous = git('ls-tree', '-r', '--name-only', sha, '--', migrationRoot)
    .trim()
    .split('\n')
    .filter(f => f.endsWith('/migration.sql'))
  for (const file of previous) {
    if (
      !existsSync(join(cwd, file)) ||
      readFileSync(join(cwd, file), 'utf8') !== git('show', `${sha}:${file}`)
    )
      throw new Error(`Published migration changed or removed: ${file}`)
  }
  const current = readdirSync(join(cwd, migrationRoot), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => `${migrationRoot}/${d.name}/migration.sql`)
    .filter(f => existsSync(join(cwd, f)))
    .sort()
  const added = current.filter(file => !previous.includes(file))
  for (const file of added) {
    if (previous.length && file <= previous.at(-1))
      throw new Error(`New migration predates the base: ${file}`)
    validateNewMigration(readFileSync(join(cwd, file), 'utf8'))
  }
  return { sha, previous, added, current }
}
