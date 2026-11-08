import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { testDatabase as db } from '@/tests/helpers/test-database'
import { databaseRequest as request } from '@/tests/helpers/database-api-fixtures'
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/tests/helpers/test-database')).testDatabase
}))
// Mock instance configuration only. Authentication, JWT verification, owner
// resolution, request validation, handlers, Prisma and PostgreSQL remain real.
vi.mock('@/lib/config', async () => ({
  getConfig: () => databaseTestConfig
}))
import { databaseTestConfig } from '@/tests/helpers/database-api-fixtures'
import { GET, PUT, POST } from '@/app/api/wallet/recipients/route'
const A = 'a'.repeat(64),
  B = 'b'.repeat(64)
beforeAll(async () => {
  await db.user.createMany({
    data: [
      { id: 'owner-a', pubkey: A },
      { id: 'owner-b', pubkey: B }
    ]
  })
})
afterAll(async () => {
  await db.$disconnect()
})
it('authenticates real signatures and never accepts a missing or forged token', async () => {
  expect((await GET(request(null))).status).toBe(401)
  expect(
    (await GET(request(A, 'GET', undefined, 'a-different-test-signing-secret')))
      .status
  ).toBe(401)
})
it('persists A, excludes B despite forged body/query/claim IDs, and keeps each account’s same-address row independent', async () => {
  expect(
    (
      await PUT(
        request(A, 'PUT', {
          lightningAddress: 'alice@example.com',
          name: 'A private recipient'
        })
      )
    ).status
  ).toBe(200)
  expect((await (await GET(request(B))).json()).recipients).toEqual([])
  expect(
    (
      await PUT(
        request(B, 'PUT', {
          userId: 'owner-a',
          lightningAddress: 'alice@example.com',
          name: 'B recipient'
        })
      )
    ).status
  ).toBe(200)
  const recipients = (await (await GET(request(A))).json()).recipients
  expect(recipients).toHaveLength(1)
  expect(recipients[0].name).toBe('A private recipient')
  expect(
    await db.savedRecipient.count({
      where: { lightningAddress: 'alice@example.com' }
    })
  ).toBe(2)
  expect(
    (
      await POST(
        request(B, 'POST', {
          recipients: [
            {
              userId: 'owner-a',
              lightningAddress: 'import@example.com',
              lastUsedAt: new Date().toISOString()
            }
          ]
        })
      )
    ).status
  ).toBe(200)
  expect(
    await db.savedRecipient.count({
      where: { userId: 'owner-a', lightningAddress: 'import@example.com' }
    })
  ).toBe(0)
})
it('enforces note and display-alias width and recipient ownership foreign keys in PostgreSQL itself', async () => {
  await db.transactionNote.create({
    data: {
      userId: 'owner-a',
      paymentHash: '1'.repeat(64),
      note: 'n'.repeat(80)
    }
  })
  await expect(
    db.transactionNote.create({
      data: {
        userId: 'owner-a',
        paymentHash: '2'.repeat(64),
        note: 'n'.repeat(81)
      }
    })
  ).rejects.toThrow()
  await expect(
    db.counterpartyAlias.create({
      data: {
        userId: 'owner-a',
        key: 'ln:oversized@example.com',
        alias: 'a'.repeat(81)
      }
    })
  ).rejects.toThrow()
  await expect(
    db.savedRecipient.create({
      data: { userId: 'missing-owner', lightningAddress: 'nobody@example.com' }
    })
  ).rejects.toThrow()
})
