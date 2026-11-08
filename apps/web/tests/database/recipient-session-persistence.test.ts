// @vitest-environment happy-dom
import { afterAll, expect, it, vi } from 'vitest'
import { testDatabase as db } from '@/tests/helpers/test-database'
import {
  databaseRequest,
  databaseTestConfig
} from '@/tests/helpers/database-api-fixtures'
import { setRecipientSession } from '@/lib/client/recipient-session'
import {
  rememberPaymentDestination,
  readPaymentDestinations
} from '@/lib/client/payment-destinations'
import { backfillSavedRecipients } from '@/lib/client/recipient-backfill'
import { readContacts } from '@/lib/client/contacts-store'
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('@/tests/helpers/test-database')).testDatabase
}))
vi.mock('@/lib/config', () => ({ getConfig: () => databaseTestConfig }))
import { GET, POST } from '@/app/api/wallet/recipients/route'
const A = 'c'.repeat(64),
  B = 'd'.repeat(64)
afterAll(async () => {
  setRecipientSession(null)
  await db.user.deleteMany({
    where: { id: { in: ['flow-owner-a', 'flow-owner-b'] } }
  })
  await db.$disconnect()
})
it('persists A through real JWT/API/SQL, switches to B without clearing storage, and recovers A without importing legacy', async () => {
  await db.user.createMany({
    data: [
      { id: 'flow-owner-a', pubkey: A },
      { id: 'flow-owner-b', pubkey: B }
    ]
  })
  const legacy = JSON.stringify({
    old: {
      address: 'legacy@example.com',
      name: 'Unattributed',
      avatarUrl: null,
      comment: null,
      savedAt: 123
    }
  })
  localStorage.setItem('lawallet-payment-destinations', legacy)
  setRecipientSession(A)
  rememberPaymentDestination('owned-a', {
    address: 'private-a@example.com',
    name: 'Private A',
    avatarUrl: null,
    comment: 'A private note'
  })
  await backfillSavedRecipients([], async body => {
    const response = await POST(databaseRequest(A, 'POST', body))
    expect(response.status).toBe(200)
  })
  expect(
    await db.savedRecipient.count({ where: { userId: 'flow-owner-a' } })
  ).toBe(1)
  setRecipientSession(B)
  expect(readPaymentDestinations()).toEqual({})
  expect(readContacts()).toEqual([])
  const postAsB = vi.fn(async body => POST(databaseRequest(B, 'POST', body)))
  await backfillSavedRecipients([], postAsB)
  expect(postAsB).not.toHaveBeenCalled()
  expect((await (await GET(databaseRequest(B))).json()).recipients).toEqual([])
  expect(
    await db.savedRecipient.count({ where: { userId: 'flow-owner-b' } })
  ).toBe(0)
  setRecipientSession(A)
  expect(readPaymentDestinations()['owned-a'].comment).toBe('A private note')
  const server = (await (await GET(databaseRequest(A))).json()).recipients
  expect(server).toEqual([
    expect.objectContaining({ lightningAddress: 'private-a@example.com' })
  ])
  expect(
    await db.savedRecipient.count({
      where: { lightningAddress: 'legacy@example.com' }
    })
  ).toBe(0)
  expect(localStorage.getItem('lawallet-payment-destinations')).toBe(legacy)
})
