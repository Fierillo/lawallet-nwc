import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/lib/generated/prisma'
import { tmpdir } from 'node:os'
import { sep } from 'node:path'
const socket = process.env.WALLETILLA_TEST_SOCKET
if (!socket?.startsWith(`${tmpdir()}${sep}walletilla-verify-db-`)) {
  throw new Error(
    'Only the verification runner’s disposable Unix socket is permitted'
  )
}
// Never consume DATABASE_URL, dotenv files, application pools or credentials.
export const testDatabase = new PrismaClient({
  adapter: new PrismaPg({
    host: socket,
    user: 'walletilla_test',
    database: 'walletilla_test',
    port: 5432
  })
})
