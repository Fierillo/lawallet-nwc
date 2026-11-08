import { inspectMigrations } from './migration-policy.mjs'
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--base')
    throw new Error('Usage: check-migrations.mjs --base <commit/ref>')
  const delta = inspectMigrations(process.argv[3])
  console.log(
    `[migrations] ${delta.previous.length} unchanged historical migrations; ${delta.added.length} additive candidates. Real data compatibility and human review are still required.`
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
