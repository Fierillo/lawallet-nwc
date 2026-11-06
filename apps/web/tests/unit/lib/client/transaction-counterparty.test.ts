import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import b11 from 'bolt11'
import {
  abbreviateNodePubkey,
  counterpartyLnKey,
  counterpartyNodeKey,
  resolveTransactionCounterparty
} from '@/lib/client/transaction-counterparty'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'
import type { PaymentDestination } from '@/lib/client/payment-destinations'

function signedInvoice(): { bolt11: string; payee: string } {
  const priv = crypto.randomBytes(32)
  const encoded = b11.encode({
    satoshis: 21,
    timestamp: Math.floor(Date.now() / 1000),
    tags: [
      { tagName: 'payment_hash', data: crypto.randomBytes(32).toString('hex') },
      {
        tagName: 'payment_secret',
        data: crypto.randomBytes(32).toString('hex')
      },
      { tagName: 'description', data: 'Envío de BTC a alguien' }
    ]
  })
  const { paymentRequest } = b11.sign(encoded, priv)
  if (!paymentRequest) throw new Error('sign failed')
  return {
    bolt11: paymentRequest,
    payee: b11.decode(paymentRequest).payeeNodeKey!.toLowerCase()
  }
}

function tx(overrides: Partial<NwcTransaction> = {}): NwcTransaction {
  return {
    type: 'outgoing',
    amountSats: 21,
    feesPaidSats: 0,
    description: 'Envío de BTC a alguien',
    paymentHash: 'ab'.repeat(32),
    preimage: null,
    settledAt: 1,
    createdAt: 1,
    ...overrides
  }
}

describe('abbreviateNodePubkey', () => {
  it('shortens a compressed node id', () => {
    const pubkey = '02' + 'ab'.repeat(32)
    expect(abbreviateNodePubkey(pubkey)).toBe('02abab…abab')
  })
})

describe('counterparty keys', () => {
  it('normalizes lightning addresses and node pubkeys', () => {
    expect(counterpartyLnKey('Alice@Example.COM')).toBe('ln:alice@example.com')
    expect(counterpartyNodeKey('02' + 'AB'.repeat(32))).toBe(
      'node:' + ('02' + 'ab'.repeat(32))
    )
  })
})

describe('resolveTransactionCounterparty', () => {
  it('prefers destination name, then address, over the invoice description', () => {
    const destination: PaymentDestination = {
      address: 'alice@example.com',
      name: 'Alice',
      avatarUrl: null,
      comment: 'lunch',
      savedAt: 1
    }
    const resolved = resolveTransactionCounterparty(tx(), destination, null)
    expect(resolved).toEqual({
      key: 'ln:alice@example.com',
      label: 'Alice',
      nodePubkey: null,
      fallback: 'sent'
    })
  })

  it('uses the abbreviated payee node when no destination is known', () => {
    const { bolt11, payee } = signedInvoice()
    const resolved = resolveTransactionCounterparty(
      tx({ invoice: bolt11, description: 'Envío de BTC a alguien' }),
      null,
      null
    )
    expect(resolved.key).toBe(`node:${payee}`)
    expect(resolved.label).toBe(abbreviateNodePubkey(payee))
    expect(resolved.nodePubkey).toBe(payee)
    expect(resolved.fallback).toBe('sent')
  })

  it('applies a stored alias over recipient and node id', () => {
    const destination: PaymentDestination = {
      address: 'alice@example.com',
      name: 'Alice',
      avatarUrl: null,
      comment: null,
      savedAt: 1
    }
    const resolved = resolveTransactionCounterparty(tx(), destination, 'Ana')
    expect(resolved.label).toBe('Ana')
    expect(resolved.key).toBe('ln:alice@example.com')
  })

  it('falls back to sent/received and drops the description label', () => {
    expect(
      resolveTransactionCounterparty(
        tx({
          type: 'incoming',
          description: 'Payment to @bob: gracias!',
          invoice: null
        }),
        null,
        null
      )
    ).toEqual({
      key: null,
      label: null,
      nodePubkey: null,
      fallback: 'received'
    })
  })

  it('does not treat our own incoming invoice payee as the counterparty', () => {
    const { bolt11 } = signedInvoice()
    const resolved = resolveTransactionCounterparty(
      tx({ type: 'incoming', invoice: bolt11 }),
      null,
      null
    )
    expect(resolved.key).toBeNull()
    expect(resolved.label).toBeNull()
    expect(resolved.fallback).toBe('received')
  })
})
