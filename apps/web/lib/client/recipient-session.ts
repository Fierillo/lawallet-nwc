'use client'

// Browser persistence is partitioned by authenticated identity, not JWT/token
// text. Linked identities may have separate local caches; the server remains
// authoritative for account-level contacts. An epoch object also rejects A→B→A
// async completions even when the final identity is the same.
let session: Readonly<{ owner: string | null }> = { owner: null }
const listeners = new Set<() => void>()
export function getRecipientSession() {
  return session
}
export function setRecipientSession(owner: string | null) {
  if (session.owner === owner) return
  session = { owner }
  for (const listener of listeners) listener()
}
export function recipientStorageKey(base: string): string | null {
  return session.owner ? `${base}:${encodeURIComponent(session.owner)}` : null
}
export function subscribeRecipientSession(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
