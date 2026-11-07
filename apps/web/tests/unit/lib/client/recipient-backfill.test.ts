import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  backfillSavedRecipients,
  historyRecipients,
  __resetRecipientBackfillForTests
} from '@/lib/client/recipient-backfill'
import {
  __resetContactsCacheForTests,
  contactsActions
} from '@/lib/client/contacts-store'
import {
  __resetPaymentDestinationsForTests,
  rememberPaymentDestination
} from '@/lib/client/payment-destinations'

const day = 24 * 60 * 60 * 1000
const t0 = Date.parse('2026-10-01T00:00:00.000Z')

describe('historyRecipients', () => {
  it('turns paid addresses and saved contacts into recipients, newest use first', () => {
    const result = historyRecipients(
      [
        {
          id: 'c1',
          name: 'Bob',
          lightningAddress: 'bob@example.com',
          createdAt: t0 + 2 * day
        }
      ],
      {
        hash1: {
          address: 'Ariel@LaCrypta.ar',
          name: 'Ariel',
          avatarUrl: 'data:image/png;base64,AAAA',
          comment: null,
          savedAt: t0
        },
        hash2: {
          address: 'ariel@lacrypta.ar',
          name: null,
          avatarUrl: null,
          comment: 'hi',
          savedAt: t0 + day
        },
        hash3: {
          address: 'not an address',
          name: null,
          avatarUrl: null,
          comment: null,
          savedAt: t0 + 3 * day
        }
      }
    )
    expect(result).toEqual([
      {
        lightningAddress: 'bob@example.com',
        name: 'Bob',
        avatarUrl: null,
        lastUsedAt: new Date(t0 + 2 * day).toISOString()
      },
      {
        lightningAddress: 'ariel@lacrypta.ar',
        name: 'Ariel',
        avatarUrl: null,
        lastUsedAt: new Date(t0 + day).toISOString()
      }
    ])
  })
})

describe('backfillSavedRecipients', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    __resetPaymentDestinationsForTests()
    __resetRecipientBackfillForTests()
  })

  it('uploads only history the account lacks, once per session, and lists it locally', async () => {
    rememberPaymentDestination('a'.repeat(64), {
      address: 'ariel@lacrypta.ar',
      name: 'Ariel',
      avatarUrl: null,
      comment: null
    })
    contactsActions.upsertRecent({ lightningAddress: 'bob@example.com' })
    const post = vi.fn().mockResolvedValue({ inserted: 1 })
    const server = [
      {
        lightningAddress: 'bob@example.com',
        name: 'Bob',
        avatarUrl: null,
        lastUsedAt: new Date(t0).toISOString()
      }
    ]

    await backfillSavedRecipients(server, post)
    await backfillSavedRecipients(server, post)

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({
      recipients: [
        expect.objectContaining({
          lightningAddress: 'ariel@lacrypta.ar',
          name: 'Ariel'
        })
      ]
    })
    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]'
    )
    expect(
      stored.map((c: { lightningAddress: string }) => c.lightningAddress)
    ).toContain('ariel@lacrypta.ar')
  })

  it('skips the request when the account already has everything', async () => {
    const post = vi.fn()
    await backfillSavedRecipients([], post)
    expect(post).not.toHaveBeenCalled()
  })

  it('swallows upload failures', async () => {
    contactsActions.upsertRecent({ lightningAddress: 'bob@example.com' })
    const post = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(backfillSavedRecipients([], post)).resolves.toBeUndefined()
  })
})
