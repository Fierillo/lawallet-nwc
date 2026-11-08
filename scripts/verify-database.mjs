import { spawn, spawnSync, execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  existsSync,
  readFileSync,
  rmSync,
  openSync,
  closeSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { databaseEnvironment } from './database-environment.mjs'
import { once } from 'node:events'
import { inspectMigrations } from './migration-policy.mjs'

if (process.argv.length !== 4 || process.argv[2] !== '--base')
  throw new Error('Usage: verify-database.mjs --base <commit/ref>')
const delta = inspectMigrations(process.argv[3])
const tools = process.env.HERRAMIENTAS_DIR || '/workspace/herramientas'
const candidates = [
  process.env.WALLETILLA_PG_BIN,
  `${tools}/postgresql-17.11/bin`,
  ...(existsSync('/usr/lib/postgresql')
    ? readdirSync('/usr/lib/postgresql')
        .sort((a, b) => parseInt(b) - parseInt(a))
        .map(v => `/usr/lib/postgresql/${v}/bin`)
    : [])
].filter(Boolean)
const bin = candidates.find(p =>
  ['initdb', 'postgres'].every(name => existsSync(join(p, name)))
)
if (!bin)
  throw new Error(
    'PostgreSQL initdb/postgres required: set WALLETILLA_PG_BIN to local binaries. No external database URL is accepted; refusing to skip database verification.'
  )
const directory = mkdtempSync(join(tmpdir(), 'walletilla-verify-db-'))
const data = join(directory, 'data')
const env = databaseEnvironment(process.env, directory, bin)
const sql = text =>
  execFileSync(
    'psql',
    ['-X', '--no-password', '-qAt', '--set', 'ON_ERROR_STOP=1'],
    { env, input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
let server
let log
try {
  execFileSync(
    join(bin, 'initdb'),
    [
      '-D',
      data,
      '-A',
      'trust',
      '-U',
      'walletilla_test',
      '--no-locale',
      '--encoding=UTF8'
    ],
    { env, stdio: 'pipe' }
  )
  log = openSync(join(directory, 'server.log'), 'a')
  server = spawn(
    join(bin, 'postgres'),
    ['-D', data, '-F', '-k', directory, '-h', '', '-p', '5432'],
    { env, stdio: ['ignore', log, log] }
  )
  const stop = () => server?.kill('SIGTERM')
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(readFileSync(join(directory, 'server.log'), 'utf8'))
    try {
      sql('SELECT 1')
      ready = true
      break
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  if (!ready) throw new Error('Disposable PostgreSQL failed readiness check')
  sql('CREATE DATABASE walletilla_test')
  env.PGDATABASE = 'walletilla_test'
  console.log(
    `[database] private Unix socket only; base=${delta.sha}; ${delta.previous.length} historical + ${delta.added.length} new migrations`
  )
  for (const file of delta.previous) sql(readFileSync(file, 'utf8'))
  // Seed real baseline application data before applying new migrations.
  sql(`INSERT INTO "User" ("id","pubkey") VALUES ('compatibility-owner',repeat('f',64));
 INSERT INTO "TransactionNote" ("userId","paymentHash","note") VALUES ('compatibility-owner',repeat('f',64),repeat('n',80));
 INSERT INTO "CounterpartyAlias" ("id","userId","key","alias","updatedAt") VALUES ('compat-alias','compatibility-owner','ln:compat@example.com',repeat('a',80),now());`)
  const columnSql = `SELECT table_name,column_name,data_type,COALESCE(character_maximum_length,0),is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name;`
  const previous = sql(columnSql)
    .split('\n')
    .map(row => row.split('|'))
  for (const file of delta.added) sql(readFileSync(file, 'utf8'))
  const current = new Map(
    sql(columnSql)
      .split('\n')
      .map(row => {
        const p = row.split('|')
        return [p.slice(0, 2).join('.'), p]
      })
  )
  for (const old of previous) {
    const next = current.get(old.slice(0, 2).join('.'))
    if (
      !next ||
      old[2] !== next[2] ||
      (Number(old[3]) > Number(next[3]) && Number(next[3]) !== 0) ||
      (old[4] === 'YES' && next[4] !== 'YES')
    )
      throw new Error(
        `Potentially incompatible column change: ${old.slice(0, 2).join('.')}`
      )
  }
  if (
    sql(
      `SELECT "note"=repeat('n',80) FROM "TransactionNote" WHERE "userId"='compatibility-owner'`
    ) !== 't'
  )
    throw new Error('Migration changed baseline note')
  if (
    sql(
      `SELECT "alias"=repeat('a',80) FROM "CounterpartyAlias" WHERE "id"='compat-alias'`
    ) !== 't'
  )
    throw new Error('Migration changed baseline alias')
  const url = `postgresql://walletilla_test@localhost:5432/walletilla_test?host=${encodeURIComponent(directory)}`
  const report = join(directory, 'results.json')
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@lawallet-nwc/web',
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.database.config.ts',
      '--reporter=json',
      '--outputFile',
      report
    ],
    {
      stdio: 'inherit',
      env: {
        ...env,
        WALLETILLA_TEST_SOCKET: directory,
        DATABASE_URL: url,
        CARD_PAYMENT_TEST_DATABASE_URL: url,
        NWC_VAULT_TEST_DATABASE_URL: url,
        NWC_VAULT_SECRET:
          'synthetic-native-postgres-test-vault-secret-01234567890123456789',
        JWT_SECRET:
          'synthetic-native-postgres-test-jwt-secret-01234567890123456789',
        LOG_LEVEL: 'silent'
      },
      timeout: 120_000
    }
  )
  if (result.status !== 0)
    throw new Error(
      `Real database contracts failed: ${result.error?.message || result.status}`
    )
  const summary = JSON.parse(readFileSync(report, 'utf8'))
  if (
    !summary.numTotalTests ||
    summary.numPendingTests ||
    summary.numPassedTests !== summary.numTotalTests
  )
    throw new Error(
      'Database verification must execute every contract with no skips'
    )
  console.log(
    `[database] ${summary.numPassedTests} real database tests passed, zero skips`
  )
  console.log(
    '[database] real JWT/auth, owner-scoped API persistence, DB constraints and baseline data compatibility passed'
  )
} finally {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit')
    server.kill('SIGTERM')
    await exited
  }
  if (log !== undefined) closeSync(log)
  rmSync(directory, { recursive: true, force: true })
}
