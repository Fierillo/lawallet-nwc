import { __resetContactsCacheForTests } from '@/lib/client/contacts-store'
import {
  setRecipientSession,
  recipientStorageKey
} from '@/lib/client/recipient-session'
export const ACCOUNT_A = 'a'.repeat(64)
export const ACCOUNT_B = 'b'.repeat(64)
export function recipientSession(owner: string | null = ACCOUNT_A) {
  setRecipientSession(owner)
}
export function paymentDestination(address = 'alice@example.com') {
  return { address, name: 'Alice', avatarUrl: null, comment: 'Private note' }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}

export function recipientKey(base: string) {
  const key = recipientStorageKey(base)
  if (!key)
    throw new Error(
      'The fixture must select an authenticated recipient session'
    )
  return key
}

export function seedRecipientContacts(count: number) {
  const contacts = Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    name: `user${index}`,
    lightningAddress: `user${index}@lawallet.io`,
    createdAt: 1000 - index
  }))
  localStorage.setItem(
    recipientKey('lawallet-contacts'),
    JSON.stringify(contacts)
  )
  __resetContactsCacheForTests()
}
