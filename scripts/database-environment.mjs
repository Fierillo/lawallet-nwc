import { join, dirname } from 'node:path'

export function databaseEnvironment(inherited, directory, bin) {
  // libpq's PGHOSTADDR/service settings can override a socket host even when
  // DATABASE_URL is ignored. Never inherit routing or authentication settings.
  const safe = Object.fromEntries(
    Object.entries(inherited).filter(([key]) => !key.startsWith('PG'))
  )
  return {
    ...safe,
    LD_LIBRARY_PATH: `${join(dirname(bin), 'lib')}:${inherited.LD_LIBRARY_PATH || ''}`,
    PGHOST: directory,
    PGPORT: '5432',
    PGUSER: 'walletilla_test',
    PGDATABASE: 'postgres',
    PGPASSFILE: '/dev/null',
    PGSERVICEFILE: '/dev/null'
  }
}
