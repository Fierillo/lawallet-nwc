'use client'

import { getNwcClient } from './nwc-client'

export type NwcTransactionState = 'settled' | 'pending' | 'failed'

export interface NwcTransaction {
  type: 'incoming' | 'outgoing'
  amountSats: number
  feesPaidSats: number
  /**
   * Exact NIP-47 `fees_paid` in msats when the wallet reported it; `null` when
   * the field was omitted. Used for sub-sat fee display in the activity row.
   */
  feesPaidMsats?: number | null
  description: string
  paymentHash: string
  preimage: string | null
  settledAt: number | null
  createdAt: number
  /** BOLT11 from the wallet when NIP-47 includes it; used for payee identity. */
  invoice?: string | null
  /** Wallet-reported NIP-47 state when the payload includes it. */
  state?: NwcTransactionState
}

export function nwcTransactionState(tx: NwcTransaction): NwcTransactionState {
  if (
    tx.state === 'settled' ||
    tx.state === 'pending' ||
    tx.state === 'failed'
  ) {
    return tx.state
  }
  return tx.settledAt ? 'settled' : 'pending'
}

export interface ListTransactionsOpts {
  limit?: number
  /** Unix seconds; include only transactions created before this. */
  until?: number
  /** Unix seconds; include only transactions created after this. */
  from?: number
  type?: 'incoming' | 'outgoing'
}

interface RawTransaction {
  type?: 'incoming' | 'outgoing' | string | null
  amount?: number | null
  fees_paid?: number | null
  description?: string | null
  payment_hash?: string | null
  preimage?: string | null
  settled_at?: number | null
  created_at?: number | null
  invoice?: string | null
  state?: string | null
}

function normalizeState(raw: RawTransaction): NwcTransactionState | undefined {
  if (
    raw.state === 'settled' ||
    raw.state === 'pending' ||
    raw.state === 'failed'
  ) {
    return raw.state
  }
  return undefined
}

function normalize(raw: RawTransaction): NwcTransaction | null {
  const paymentHash = raw.payment_hash?.trim()
  if (!paymentHash) return null
  const invoice = raw.invoice?.trim() || null
  const feesPaidMsats = normalizeFeesPaidMsats(raw.fees_paid)
  return {
    type: raw.type === 'outgoing' ? 'outgoing' : 'incoming',
    amountSats: Math.floor((raw.amount ?? 0) / 1000),
    feesPaidSats: Math.floor((feesPaidMsats ?? 0) / 1000),
    feesPaidMsats,
    description: raw.description ?? '',
    paymentHash,
    preimage: raw.preimage ?? null,
    settledAt: raw.settled_at ? raw.settled_at * 1000 : null,
    createdAt: (raw.created_at ?? 0) * 1000,
    invoice,
    state: normalizeState(raw)
  }
}

/**
 * NIP-47 `fees_paid` in msats, or `null` when omitted. LNbits'
 * `list_transactions` passes its internal fee through, which is negative for
 * outgoing payments, so the sign is dropped instead of clamping it to zero.
 */
export function normalizeFeesPaidMsats(
  feesPaid: number | null | undefined
): number | null {
  if (feesPaid == null || !Number.isFinite(feesPaid)) return null
  return Math.floor(Math.abs(feesPaid))
}

/**
 * Compact sats label for the activity-row fee line. Returns null when there is
 * nothing useful to show (missing or zero). Sub-sat positive fees render as
 * `<1` so floor-to-sats does not hide a real routing cost.
 */
export function activityFeeAmountLabel(
  feesPaidMsats: number | null | undefined
): string | null {
  if (feesPaidMsats == null || feesPaidMsats <= 0) return null
  if (feesPaidMsats < 1000) return '<1'
  return Math.floor(feesPaidMsats / 1000).toLocaleString()
}

/**
 * Calls NWC `list_transactions`. Returns an empty array if the wallet
 * doesn't support the method (feature-detect via `getInfo().methods` before
 * surfacing the activity feed if you need a cleaner UX).
 */
export async function listTransactions(
  nwcString: string,
  opts: ListTransactionsOpts = {}
): Promise<NwcTransaction[]> {
  const client = await getNwcClient(nwcString)
  const res = (await client.listTransactions({
    limit: opts.limit ?? 20,
    until: opts.until,
    from: opts.from,
    type: opts.type
  })) as { transactions?: RawTransaction[] }
  const list = res.transactions ?? []
  return list.flatMap(raw => {
    const tx = normalize(raw)
    return tx ? [tx] : []
  })
}

/**
 * Resolves one transaction by payment hash via NWC `lookup_invoice`.
 * Returns `null` when the wallet has no matching invoice or the method
 * isn't supported — callers should fall back to the local activity cache.
 */
export async function lookupTransaction(
  nwcString: string,
  paymentHash: string
): Promise<NwcTransaction | null> {
  const hash = paymentHash.trim()
  if (!nwcString || !hash) return null
  try {
    const client = await getNwcClient(nwcString)
    const res = (await client.lookupInvoice({
      payment_hash: hash
    })) as RawTransaction
    return normalize(res)
  } catch {
    return null
  }
}
