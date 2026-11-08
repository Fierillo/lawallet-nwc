import { spawnSync } from 'node:child_process'
import {
  collectChanges,
  planVerification,
  runPlan
} from './verification-plan.mjs'
const [mode, ...args] = process.argv.slice(2)
try {
  if (args.length !== 2 || args[0] !== '--base')
    throw new Error(
      'Usage: verify-walletilla.mjs dev|pre-main --base <commit/ref>'
    )
  const changes = collectChanges(args[1])
  console.log(
    `[verify] mode=${mode} base=${changes.baseSha}; changed=${changes.files.length}, deleted=${changes.deleted.length}; index and untracked included`
  )
  runPlan(planVerification(mode, changes, args[1]), phase => {
    const result = spawnSync(phase.command, phase.args, {
      stdio: 'inherit',
      env: { ...process.env, ...phase.env },
      timeout: 600_000
    })
    if (result.error) console.error(result.error.message)
    return result.status ?? 1
  })
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
