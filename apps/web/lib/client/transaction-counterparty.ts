import { extractPayeePubkey } from '@/lib/invoice-utils'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'
import type { PaymentDestination } from '@/lib/client/payment-destinations'

const NODE_PUBKEY_RE = /^0[23][0-9a-f]{64}$/

export function abbreviateNodePubkey(pubkey: string): string {
  const hex = pubkey.toLowerCase()
  if (hex.length < 10) return hex
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`
}

export function counterpartyLnKey(address: string): string {
  return `ln:${address.trim().toLowerCase()}`
}

export function counterpartyNodeKey(pubkey: string): string {
  return `node:${pubkey.trim().toLowerCase()}`
}

export interface TransactionCounterparty {
  /** Stable per-user alias key, or null when nothing identifiable. */
  key: string | null
  /** Display label before i18n fallback (alias / name / address / abbrev). */
  label: string | null
  nodePubkey: string | null
  fallback: 'sent' | 'received'
}

/**
 * Title identity for a wallet activity row: Lightning Address destination when
 * known, else the BOLT11 payee node for *outgoing* payments, else sent/received.
 * Never uses the invoice description as the title.
 */
export function resolveTransactionCounterparty(
  tx: Pick<NwcTransaction, 'type' | 'invoice'>,
  destination: PaymentDestination | null | undefined,
  alias: string | null | undefined
): TransactionCounterparty {
  const fallback = tx.type === 'incoming' ? 'received' : 'sent'
  const address = destination?.address?.trim() || null
  const name = destination?.name?.trim() || null

  let key: string | null = null
  let label: string | null = null
  let nodePubkey: string | null = null

  if (address) {
    key = counterpartyLnKey(address)
    label = name || address
  } else if (tx.type === 'outgoing' && tx.invoice) {
    const payee = extractPayeePubkey(tx.invoice)
    if (payee && NODE_PUBKEY_RE.test(payee)) {
      nodePubkey = payee
      key = counterpartyNodeKey(payee)
      label = abbreviateNodePubkey(payee)
    }
  }

  if (alias?.trim()) {
    return { key, label: alias.trim(), nodePubkey, fallback }
  }

  return { key, label, nodePubkey, fallback }
}
