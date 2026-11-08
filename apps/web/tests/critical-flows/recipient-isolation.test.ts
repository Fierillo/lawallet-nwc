import { beforeEach, expect, it, vi } from 'vitest'
import {
  rememberPaymentDestination,
  readPaymentDestinations,
  __resetPaymentDestinationsForTests
} from '@/lib/client/payment-destinations'
import {
  backfillSavedRecipients,
  __resetRecipientBackfillForTests,
  seedContactsFromHistory
} from '@/lib/client/recipient-backfill'
import { clearSessionCaches } from '@/lib/client/cache/session-cache'
import {
  contactsActions,
  readContacts,
  readContactFailures,
  __resetContactsCacheForTests
} from '@/lib/client/contacts-store'
import {
  ACCOUNT_A,
  ACCOUNT_B,
  recipientSession,
  paymentDestination,
  deferred
} from '@/tests/helpers/recipient-fixtures'
import { getRecipientSession } from '@/lib/client/recipient-session'
const { relayQuery } = vi.hoisted(() => ({ relayQuery: vi.fn() }))
vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    querySync = relayQuery
    close() {}
  }
}))

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  recipientSession(null)
  __resetPaymentDestinationsForTests()
  __resetContactsCacheForTests()
  __resetRecipientBackfillForTests()
})
it('persists A, switches directly to B without clearing storage, never reads/uploads A, and restores A', async () => {
  recipientSession(ACCOUNT_A)
  rememberPaymentDestination('account-a-hash', paymentDestination())
  contactsActions.upsertRecent({
    lightningAddress: 'alice@example.com',
    name: 'Alice'
  })
  expect(readPaymentDestinations()['account-a-hash']).toEqual(
    expect.objectContaining(paymentDestination())
  )
  contactsActions.setPaymentFailure('alice@example.com', 'Private A failure')
  const stored = { ...localStorage }
  recipientSession(ACCOUNT_B)
  expect(readPaymentDestinations()).toEqual({})
  expect(readContacts()).toEqual([])
  expect(readContactFailures()).toEqual({})
  const postAsB = vi.fn()
  await backfillSavedRecipients([], postAsB)
  expect(postAsB).not.toHaveBeenCalled()
  expect({ ...localStorage }).toEqual(stored)
  recipientSession(ACCOUNT_A)
  expect(readContactFailures()['alice@example.com']).toBe('Private A failure')
  const postAsA = vi.fn().mockResolvedValue({})
  await backfillSavedRecipients([], postAsA)
  expect(postAsA).toHaveBeenCalledWith({
    recipients: [
      expect.objectContaining({ lightningAddress: 'alice@example.com' })
    ]
  })
  expect(readPaymentDestinations()['account-a-hash'].comment).toBe(
    'Private note'
  )
})
it('keeps unattributed legacy bytes but never reads or backfills them into an arbitrary account', async () => {
  const legacy = JSON.stringify({
    legacy: { ...paymentDestination(), savedAt: 123 }
  })
  localStorage.setItem('lawallet-payment-destinations', legacy)
  localStorage.setItem(
    'lawallet-contacts',
    JSON.stringify([
      {
        ...paymentDestination(),
        lightningAddress: 'legacy@example.com',
        createdAt: 123
      }
    ])
  )
  const legacyContacts = localStorage.getItem('lawallet-contacts')
  recipientSession(ACCOUNT_B)
  seedContactsFromHistory()
  const post = vi.fn()
  await backfillSavedRecipients([], post)
  expect(post).not.toHaveBeenCalled()
  expect(readContacts()).toEqual([])
  expect(localStorage.getItem('lawallet-payment-destinations')).toBe(legacy)
  await clearSessionCaches()
  expect(localStorage.getItem('lawallet-payment-destinations')).toBe(legacy)
  expect(localStorage.getItem('lawallet-contacts')).toBe(legacyContacts)
})
it.each([ACCOUNT_A, ACCOUNT_B])(
  'drops a successful late A profile response after switch to %s',
  async owner => {
    const profile =
      deferred<Array<{ pubkey: string; created_at: number; content: string }>>()
    relayQuery.mockReturnValue(profile.promise)
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ names: { alice: ACCOUNT_A } }))
        )
    )
    recipientSession(ACCOUNT_A)
    const originalSession = getRecipientSession()
    const pending = contactsActions.hydrateNip05Profile('alice@example.com')
    await vi.waitFor(() => expect(relayQuery).toHaveBeenCalled())
    recipientSession(ACCOUNT_B)
    if (owner === ACCOUNT_A) recipientSession(ACCOUNT_A)
    expect(getRecipientSession()).not.toBe(originalSession)
    profile.resolve([
      {
        pubkey: ACCOUNT_A,
        created_at: 123,
        content: JSON.stringify({ name: 'Private A' })
      }
    ])
    await pending
    expect(readContacts()).toEqual([])
    vi.unstubAllGlobals()
  }
)
it('logout hides current data without deleting the account history; returning A restores it', async () => {
  recipientSession(ACCOUNT_A)
  rememberPaymentDestination('a', paymentDestination())
  await clearSessionCaches()
  expect(readPaymentDestinations()).toEqual({})
  recipientSession(ACCOUNT_A)
  expect(readPaymentDestinations().a.address).toBe('alice@example.com')
})
