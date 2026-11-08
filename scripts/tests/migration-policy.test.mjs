import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateNewMigration,
  inspectMigrations,
  migrationRoot
} from '../migration-policy.mjs'
for (const sql of [
  'CREATE TABLE "X" ("id" TEXT PRIMARY KEY);',
  'CREATE INDEX "x" ON "X"("id");',
  'ALTER TABLE "X" ADD COLUMN "note" VARCHAR(80);',
  'ALTER TABLE "X" ALTER COLUMN "note" TYPE VARCHAR(100);'
])
  test(`allows additive candidate: ${sql}`, () =>
    assert.doesNotThrow(() => validateNewMigration(sql)))
for (const sql of [
  'DROP TABLE "X";',
  'DELETE FROM "X";',
  'UPDATE "X" SET "note" = LEFT("note",80);',
  'ALTER TABLE "X" DROP COLUMN "note";',
  'TRUNCATE "X";',
  'ALTER TABLE "X" ADD COLUMN "required" TEXT NOT NULL;',
  'DO $$ BEGIN END $$;',
  ''
])
  test(`requires human decision for destructive/unknown candidate: ${sql}`, () =>
    assert.throws(() => validateNewMigration(sql)))
test('comments do not become SQL and unknown statements cannot hide after allowed SQL', () => {
  assert.doesNotThrow(() =>
    validateNewMigration(
      '-- DROP is discussed, not executed\nCREATE TABLE "X" ("id" TEXT);'
    )
  )
  assert.throws(() =>
    validateNewMigration('CREATE TABLE "X" ("id" TEXT); DROP TABLE "Y";')
  )
})

test('real Git history forbids published migration rewrites and backdated additions', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'walletilla-migrations-'))
  const git = (...args) =>
    execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim()
  const published = `${migrationRoot}/20260101000000_base/migration.sql`
  const create = (file, sql) => {
    mkdirSync(join(cwd, file, '..'), { recursive: true })
    writeFileSync(join(cwd, file), sql)
  }
  try {
    git('init')
    git('config', 'user.name', 'test')
    git('config', 'user.email', 'test@example.invalid')
    create(published, 'CREATE TABLE "X" ("id" TEXT);')
    git('add', published)
    git('commit', '-m', 'base')
    const base = git('rev-parse', 'HEAD')
    create(
      `${migrationRoot}/20260201000000_new/migration.sql`,
      'CREATE INDEX "ix" ON "X"("id");'
    )
    assert.equal(inspectMigrations(base, cwd).added.length, 1)
    writeFileSync(join(cwd, published), 'CREATE TABLE "Y" ("id" TEXT);')
    assert.throws(
      () => inspectMigrations(base, cwd),
      /Published migration changed/
    )
    writeFileSync(join(cwd, published), 'CREATE TABLE "X" ("id" TEXT);')
    create(
      `${migrationRoot}/20250101000000_backdated/migration.sql`,
      'CREATE TABLE "Z" ("id" TEXT);'
    )
    assert.throws(() => inspectMigrations(base, cwd), /predates the base/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
