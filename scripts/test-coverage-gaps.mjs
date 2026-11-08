import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { pathToFileURL } from 'node:url'
export function coverageGaps(packages) {
  return packages
    .filter(pkg => pkg.scripts?.test && !pkg.scripts['test:coverage'])
    .map(pkg => pkg.name)
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = process.cwd()
  const workspaces = JSON.parse(
    execFileSync('pnpm', ['--recursive', 'list', '--depth', '-1', '--json'], {
      encoding: 'utf8'
    })
  )
  const packages = workspaces
    .filter(pkg => pkg.path !== root)
    .map(pkg => {
      if (relative(root, pkg.path).startsWith('..'))
        throw new Error('Workspace outside repository')
      return JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'))
    })
  const gaps = coverageGaps(packages)
  console.log(
    `[coverage] ${gaps.length} workspace test scripts without a coverage script; none may be silently skipped`
  )
  for (const name of gaps) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name))
      throw new Error('Invalid workspace name')
    const result = spawnSync('pnpm', ['--filter', name, 'test'], {
      stdio: 'inherit',
      timeout: 180_000
    })
    if (result.status !== 0)
      throw new Error(`Uncovered workspace test failed: ${name}`)
  }
}
