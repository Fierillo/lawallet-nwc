import {
  recipientSession,
  recipientKey
} from '@/tests/helpers/recipient-fixtures'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  contactsActions,
  readContactFailures,
  savedRecipientPayload,
  __resetContactsCacheForTests
} from '@/lib/client/contacts-store'

describe('contacts-store', () => {
  beforeEach(() => {
    recipientSession()
    window.localStorage.clear()
    __resetContactsCacheForTests()
  })

  it('adds a contact and persists it to localStorage', () => {
    const contact = contactsActions.add({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com'
    })

    expect(contact.id).toBeTruthy()
    expect(contact.createdAt).toBeGreaterThan(0)

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].lightningAddress).toBe('satoshi@example.com')
  })

  it('upserts recent Lightning addresses without duplicates', () => {
    contactsActions.upsertRecent({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com'
    })
    contactsActions.upsertRecent({
      name: 'Alice',
      lightningAddress: 'alice@example.com'
    })
    contactsActions.upsertRecent({
      name: 'Satoshi Nakamoto',
      lightningAddress: 'SATOSHI@example.com',
      avatarUrl: 'https://example.com/avatar.png'
    })

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(stored).toHaveLength(2)
    expect(stored[0]).toMatchObject({
      name: 'Satoshi Nakamoto',
      lightningAddress: 'satoshi@example.com',
      avatarUrl: 'https://example.com/avatar.png'
    })
    expect(stored[1].lightningAddress).toBe('alice@example.com')
  })

  it('preserves recent order when a profile refresh does not touch usage', () => {
    contactsActions.upsertRecent({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com'
    })
    contactsActions.upsertRecent({
      name: 'Alice',
      lightningAddress: 'alice@example.com'
    })
    contactsActions.upsertRecent({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com',
      avatarUrl: 'https://example.com/avatar.png',
      touch: false
    })

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(
      stored.map(
        (contact: { lightningAddress: string }) => contact.lightningAddress
      )
    ).toEqual(['alice@example.com', 'satoshi@example.com'])
    expect(stored[1].avatarUrl).toBe('https://example.com/avatar.png')
  })

  it('keeps a cached NIP-05 display name and avatar across fallback updates', () => {
    contactsActions.upsertRecent({
      name: 'agustin',
      displayName: 'Agustin Kassis',
      lightningAddress: 'agustin@lacrypta.ar',
      pubkey:
        '2ad91f1dca2dcd5fc89e7208d1e5059f0bac0870d63fc3bac21c7a9388fa18fd',
      avatarUrl: 'https://example.com/agustin.png'
    })
    contactsActions.upsertRecent({
      name: 'agustin',
      lightningAddress: 'agustin@lacrypta.ar',
      touch: false
    })

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      displayName: 'Agustin Kassis',
      avatarUrl: 'https://example.com/agustin.png',
      lightningAddress: 'agustin@lacrypta.ar'
    })
  })

  it('deduplicates contacts that resolve to the same Nostr identity', () => {
    const pubkey =
      '2ad91f1dca2dcd5fc89e7208d1e5059f0bac0870d63fc3bac21c7a9388fa18fd'

    contactsActions.upsertRecent({
      name: 'El Gorila',
      displayName: 'El Gorila',
      lightningAddress: 'agustin@lawallet.io',
      pubkey,
      avatarUrl: 'https://example.com/agustin.png'
    })
    contactsActions.upsertRecent({
      name: 'El Gorila',
      displayName: 'El Gorila',
      lightningAddress: 'agustin@lacrypta.ar',
      pubkey,
      avatarUrl: 'https://example.com/agustin.png'
    })

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      displayName: 'El Gorila',
      lightningAddress: 'agustin@lacrypta.ar',
      pubkey
    })
  })

  it('updates an existing contact', () => {
    const contact = contactsActions.add({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com'
    })
    contactsActions.update(contact.id, { name: 'Nakamoto' })

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(stored[0].name).toBe('Nakamoto')
  })

  it('removes a contact', () => {
    const a = contactsActions.add({
      name: 'A',
      lightningAddress: 'a@example.com'
    })
    contactsActions.add({ name: 'B', lightningAddress: 'b@example.com' })
    contactsActions.remove(a.id)

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('B')
  })

  it('clears every contact', () => {
    contactsActions.add({ name: 'A', lightningAddress: 'a@example.com' })
    contactsActions.add({ name: 'B', lightningAddress: 'b@example.com' })
    contactsActions.clear()
    expect(
      JSON.parse(
        window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
      )
    ).toHaveLength(0)
  })

  it('merges server recipients into the local cache by last use', () => {
    contactsActions.add({
      name: 'Local Bob',
      lightningAddress: 'bob@example.com'
    })
    const local = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )[0]

    contactsActions.mergeRemote([
      {
        lightningAddress: 'carol@example.com',
        name: 'Carol',
        avatarUrl: 'https://example.com/carol.png',
        lastUsedAt: new Date(local.createdAt + 60_000).toISOString()
      },
      {
        lightningAddress: 'bob@example.com',
        name: 'Server Bob',
        avatarUrl: 'https://example.com/bob.png',
        lastUsedAt: new Date(local.createdAt - 60_000).toISOString()
      },
      {
        lightningAddress: 'dave@example.com',
        name: null,
        avatarUrl: null,
        lastUsedAt: new Date(local.createdAt - 120_000).toISOString()
      }
    ])

    const stored = JSON.parse(
      window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
    )
    expect(
      stored.map((c: { lightningAddress: string }) => c.lightningAddress)
    ).toEqual(['carol@example.com', 'bob@example.com', 'dave@example.com'])
    // Local data wins; the server only fills what the device is missing.
    expect(stored[1]).toMatchObject({
      id: local.id,
      name: 'Local Bob',
      avatarUrl: 'https://example.com/bob.png',
      createdAt: local.createdAt
    })
    expect(stored[2].name).toBe('dave')
  })

  it('ignores malformed server addresses', () => {
    contactsActions.mergeRemote([
      {
        lightningAddress: 'not-an-address',
        name: null,
        avatarUrl: null,
        lastUsedAt: new Date().toISOString()
      }
    ])
    expect(
      JSON.parse(
        window.localStorage.getItem(recipientKey('lawallet-contacts')) ?? '[]'
      )
    ).toHaveLength(0)
  })

  it('builds a server payload that the API accepts', () => {
    expect(
      savedRecipientPayload({
        lightningAddress: 'alice@example.com',
        name: ' Alice ',
        avatarUrl: 'https://example.com/a.png'
      })
    ).toEqual({
      lightningAddress: 'alice@example.com',
      name: 'Alice',
      avatarUrl: 'https://example.com/a.png'
    })
    // LUD-06 inline images and oversized names are dropped, not rejected.
    expect(
      savedRecipientPayload({
        lightningAddress: 'alice@example.com',
        name: 'x'.repeat(200),
        avatarUrl: 'data:image/png;base64,AAAA'
      })
    ).toEqual({
      lightningAddress: 'alice@example.com',
      name: 'x'.repeat(80),
      avatarUrl: null
    })
  })
})

describe('contact payment alerts', () => {
  beforeEach(() => contactsActions.clear())

  it('persists failures for addresses and nodes and clears only a successful recipient', () => {
    const node = '02' + 'ab'.repeat(32)
    contactsActions.setPaymentFailure(
      ' Alice@Example.com ',
      'Pedile un invoice.'
    )
    contactsActions.setPaymentFailure(node, 'No se encontró ruta.')
    __resetContactsCacheForTests()
    expect(readContactFailures()['alice@example.com']).toBe(
      'Pedile un invoice.'
    )
    contactsActions.setPaymentFailure('alice@example.com', null)
    __resetContactsCacheForTests()
    expect(readContactFailures()['alice@example.com']).toBeUndefined()
    expect(readContactFailures()[node]).toBe('No se encontró ruta.')
  })
})

describe('account recipient alerts', () => {
  it('uses the account state as authoritative, including cleared flags and alias-only nodes', () => {
    const node = '02' + 'ab'.repeat(32)
    contactsActions.clear()
    contactsActions.setPaymentFailure(
      'alice@example.com',
      'stale local failure'
    )
    contactsActions.mergeRemote([
      {
        lightningAddress: 'alice@example.com',
        name: null,
        avatarUrl: null,
        lastUsedAt: new Date().toISOString(),
        lastFailureReason: null,
        lastFailureAt: null
      },
      {
        lightningAddress: node,
        name: null,
        avatarUrl: null,
        lastUsedAt: new Date().toISOString(),
        lastFailureReason: 'Pedile un invoice.',
        lastFailureAt: new Date().toISOString()
      }
    ])
    expect(readContactFailures()['alice@example.com']).toBeUndefined()
    expect(readContactFailures()[node]).toBe('Pedile un invoice.')
  })
})

describe('syncing account failures', () => {
  it('sends failure and success to the account without blocking local alerts on network errors', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    await contactsActions.syncPaymentFailure(
      'ALICE@example.com',
      'Pedile un invoice.',
      save
    )
    expect(save).toHaveBeenLastCalledWith({
      lightningAddress: 'alice@example.com',
      lastFailureReason: 'Pedile un invoice.'
    })
    await contactsActions.syncPaymentFailure('alice@example.com', null, save)
    expect(save).toHaveBeenLastCalledWith({
      lightningAddress: 'alice@example.com',
      lastFailureReason: null
    })
    save.mockRejectedValue(new Error('offline'))
    await expect(
      contactsActions.syncPaymentFailure(
        'alice@example.com',
        'Reintentá.',
        save
      )
    ).resolves.toBeUndefined()
    expect(readContactFailures()['alice@example.com']).toBe('Reintentá.')
  })
})
