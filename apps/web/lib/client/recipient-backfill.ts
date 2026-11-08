'use client'

import { getRecipientSession } from './recipient-session'
import { SAVED_RECIPIENTS_IMPORT_MAX } from '@lawallet-nwc/shared'
import {
  contactsActions,
  normalizeLightningAddress,
  readContacts,
  savedRecipientPayload,
  type Contact,
  type SavedRecipient
} from '@/lib/client/contacts-store'
import {
  readPaymentDestinations,
  type PaymentDestination
} from '@/lib/client/payment-destinations'

let attempted: ReturnType<typeof getRecipientSession> | null = null

/**
 * Past recipients this device knows about: Lightning Addresses it paid (the
 * same per-payment-hash record the activity list resolves titles from) and
 * its saved contacts. One entry per address at its latest use, newest first.
 */
export function historyRecipients(
  contacts: Contact[],
  destinations: Readonly<Record<string, PaymentDestination>>
): SavedRecipient[] {
  const byAddress = new Map<string, { recipient: SavedRecipient; at: number }>()
  const add = (
    address: string,
    name: string | null | undefined,
    avatarUrl: string | null | undefined,
    at: number
  ) => {
    const lightningAddress = normalizeLightningAddress(address)
    if (!lightningAddress || !Number.isFinite(at)) return
    const payload = savedRecipientPayload({
      lightningAddress,
      name: name ?? '',
      avatarUrl
    })
    const current = byAddress.get(lightningAddress)
    const latest = !current || at > current.at
    byAddress.set(lightningAddress, {
      at: latest ? at : current.at,
      recipient: {
        ...payload,
        name: latest
          ? (payload.name ?? current?.recipient.name ?? null)
          : (current.recipient.name ?? payload.name),
        avatarUrl: latest
          ? (payload.avatarUrl ?? current?.recipient.avatarUrl ?? null)
          : (current.recipient.avatarUrl ?? payload.avatarUrl),
        lastUsedAt: new Date(latest ? at : current.at).toISOString()
      }
    })
  }

  for (const destination of Object.values(destinations)) {
    add(
      destination.address,
      destination.name,
      destination.avatarUrl,
      destination.savedAt
    )
  }
  for (const contact of contacts) {
    add(
      contact.lightningAddress,
      contact.name,
      contact.avatarUrl,
      contact.createdAt
    )
  }

  return [...byAddress.values()]
    .sort((a, b) => b.at - a.at)
    .map(entry => entry.recipient)
}

/** Lists this device's past recipients locally; needs no network. */
export function seedContactsFromHistory(): SavedRecipient[] {
  const history = historyRecipients(readContacts(), readPaymentDestinations())
  if (history.length > 0) contactsActions.mergeRecipients(history)
  return history
}

/**
 * Once per app load: list this device's past recipients locally and upload
 * the ones the account doesn't have yet in a single request. Best effort.
 */
export async function backfillSavedRecipients(
  server: SavedRecipient[],
  post: (body: { recipients: SavedRecipient[] }) => Promise<unknown>
): Promise<void> {
  const session = getRecipientSession()
  if (!session.owner || attempted === session) return
  attempted = session

  const history = seedContactsFromHistory()

  const known = new Set(server.map(r => r.lightningAddress.toLowerCase()))
  const missing = history
    .filter(r => !known.has(r.lightningAddress))
    .slice(0, SAVED_RECIPIENTS_IMPORT_MAX)
  if (missing.length === 0) return

  try {
    await post({ recipients: missing })
  } catch {
    // Next app load retries; the local list already has them.
  }
}

/** Test-only. */
export function __resetRecipientBackfillForTests(): void {
  attempted = null
}
