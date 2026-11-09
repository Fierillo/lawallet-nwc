'use client'

import { getNwcClient } from './nwc-client'
import { parseDestination, type ParsedDestination } from './parse-destination'
import { requestLnurlInvoice } from '@/lib/client/lnurl-invoice'

export interface PayResult {
  preimage: string
  feesPaidSats: number
  /** Set for keysend, where there is no invoice to read the hash from. */
  paymentHash?: string | null
}

export interface PaymentQuote {
  paymentRequest: string
  amountSats: number
  payAmountSats?: number
  expiresAt: number | null
  feeSats: number | null
  feeQuoteStatus: 'unavailable'
  feeQuoteMessage: string
  /** LUD-12 comment embedded in this invoice. Null when none was sent. */
  comment: string | null
  /** Node to pay with `pay_keysend`; `paymentRequest` is empty then. */
  keysendPubkey?: string
}

export type PaymentInputErrorCode =
  | 'amountRequired'
  | 'zeroAmountInvoice'
  | 'npubUnsupported'
  | 'keysendUnsupported'

/** Bad pay/quote input. `code` lets the wallet localize the message. */
export class PaymentInputError extends Error {
  constructor(
    readonly code: PaymentInputErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PaymentInputError'
  }
}

const NWC_FEE_QUOTE_UNAVAILABLE =
  'NWC returns routing fees only after pay_invoice settles.'

/**
 * Pays an already-decoded bolt11 invoice through the connected NWC wallet.
 * The caller is responsible for confirming the amount with the user before
 * calling this — `pay_invoice` is irrevocable once broadcast.
 *
 * Note: this resolves only when the wallet returns the `pay_invoice` response,
 * which some wallets (LNCurl/Alby) deliver slowly or drop. Callers that need
 * resilient "did it settle?" UX should ALSO watch the balance out-of-band — see
 * `WalletActions`, which races this against the server balance endpoint.
 */
export async function payInvoice(
  nwcString: string,
  bolt11: string,
  amountSats?: number
): Promise<PayResult> {
  const client = await getNwcClient(nwcString)
  const res = await client.payInvoice({
    invoice: bolt11,
    amount: amountSats !== undefined ? amountSats * 1000 : undefined
  })
  return {
    preimage: res.preimage,
    feesPaidSats: Math.floor((res.fees_paid ?? 0) / 1000)
  }
}

const walletMethods = new Map<string, Promise<string[] | null>>()

/**
 * The NIP-47 methods this connection advertises, asked once per connection.
 * Null when the wallet can't say (offline, timeout): callers then let the
 * payment try rather than block on a probe.
 */
function getWalletMethods(nwcString: string): Promise<string[] | null> {
  let methods = walletMethods.get(nwcString)
  if (!methods) {
    methods = getNwcClient(nwcString)
      .then(client => client.getInfo())
      .then(info =>
        Array.isArray(info.methods) ? info.methods.map(String) : []
      )
      .catch(() => {
        walletMethods.delete(nwcString)
        return null
      })
    walletMethods.set(nwcString, methods)
  }
  return methods
}

async function sha256Hex(hex: string): Promise<string | null> {
  if (!/^([0-9a-f]{2})+$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.match(/../g)!.map(b => parseInt(b, 16)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b =>
    b.toString(16).padStart(2, '0')
  ).join('')
}

/** Pays a node directly with NIP-47 `pay_keysend` (no invoice). */
export async function payKeysend(
  nwcString: string,
  pubkey: string,
  amountSats: number
): Promise<PayResult> {
  const client = await getNwcClient(nwcString)
  const res = await client.payKeysend({ amount: amountSats * 1000, pubkey })
  return {
    preimage: res.preimage,
    feesPaidSats: Math.floor((res.fees_paid ?? 0) / 1000),
    paymentHash: await sha256Hex(res.preimage)
  }
}

/**
 * Resolves a LUD-16 / LNURL-pay destination to a bolt11 invoice for the
 * requested amount, then pays it. Returns the preimage on success.
 */
export async function payLnurl(
  nwcString: string,
  destination: { lnurlpUrl: string; address?: string | null },
  amountSats: number,
  comment?: string
): Promise<PayResult> {
  const invoice = await requestLnurlInvoice(
    destination.lnurlpUrl,
    amountSats,
    comment
  )
  return payInvoice(nwcString, invoice.paymentRequest)
}

/**
 * Prepares the payment request that will be sent to the wallet without
 * broadcasting a payment. NWC has no standard route-fee dry-run; the exact
 * fee is still returned by `pay_invoice` after settlement.
 */
export async function quotePayment(
  destination: ParsedDestination,
  amountSats: number | null,
  comment?: string,
  /** Needed for keysend, to check the wallet offers `pay_keysend`. */
  nwcString?: string | null
): Promise<PaymentQuote> {
  if (destination.kind === 'keysend') {
    if (amountSats === null || amountSats <= 0)
      throw new PaymentInputError('amountRequired', 'Enter an amount')
    const methods = nwcString ? await getWalletMethods(nwcString) : null
    if (methods && !methods.includes('pay_keysend')) {
      throw new PaymentInputError(
        'keysendUnsupported',
        'Your wallet cannot pay a node directly (pay_keysend)'
      )
    }
    return {
      paymentRequest: '',
      keysendPubkey: destination.pubkey,
      amountSats,
      expiresAt: null,
      feeSats: null,
      feeQuoteStatus: 'unavailable',
      feeQuoteMessage: NWC_FEE_QUOTE_UNAVAILABLE,
      comment: null
    }
  }

  if (destination.kind === 'invoice') {
    if (
      destination.amountSats === null &&
      (amountSats === null || amountSats <= 0)
    ) {
      throw new PaymentInputError(
        'zeroAmountInvoice',
        'Enter an amount for this zero-amount invoice'
      )
    }
    const amount = destination.amountSats ?? amountSats ?? 0
    return {
      paymentRequest: destination.bolt11,
      amountSats: amount,
      payAmountSats: destination.amountSats === null ? amount : undefined,
      expiresAt: destination.expiresAt,
      feeSats: null,
      feeQuoteStatus: 'unavailable',
      feeQuoteMessage: NWC_FEE_QUOTE_UNAVAILABLE,
      comment: null
    }
  }

  if (destination.kind === 'lnurl-pay') {
    if (amountSats === null || amountSats <= 0)
      throw new PaymentInputError('amountRequired', 'Enter an amount')
    const invoice = await requestLnurlInvoice(
      destination.lnurlpUrl,
      amountSats,
      comment
    )
    const decoded = parseDestination(invoice.paymentRequest)
    const invoiceAmount =
      decoded.kind === 'invoice'
        ? (decoded.amountSats ?? amountSats)
        : amountSats
    const expiresAt = decoded.kind === 'invoice' ? decoded.expiresAt : null

    return {
      paymentRequest: invoice.paymentRequest,
      amountSats: invoiceAmount,
      expiresAt,
      feeSats: null,
      feeQuoteStatus: 'unavailable',
      feeQuoteMessage: NWC_FEE_QUOTE_UNAVAILABLE,
      comment: invoice.comment
    }
  }

  throw new PaymentInputError(
    'npubUnsupported',
    'Zaps to npubs are not supported yet'
  )
}

export async function payQuotedInvoice(
  nwcString: string,
  quote: PaymentQuote
): Promise<PayResult> {
  if (quote.keysendPubkey) {
    return payKeysend(nwcString, quote.keysendPubkey, quote.amountSats)
  }
  return payInvoice(nwcString, quote.paymentRequest, quote.payAmountSats)
}

/**
 * Dispatches based on destination kind. Throws for `npub` (not yet wired).
 */
export async function pay(
  nwcString: string,
  destination: ParsedDestination,
  amountSats: number | null,
  comment?: string
): Promise<PayResult> {
  if (destination.kind === 'invoice') {
    if (
      destination.amountSats === null &&
      (amountSats === null || amountSats <= 0)
    ) {
      throw new PaymentInputError(
        'zeroAmountInvoice',
        'Enter an amount for this zero-amount invoice'
      )
    }
    const amt = destination.amountSats ?? amountSats ?? 0
    return payInvoice(
      nwcString,
      destination.bolt11,
      destination.amountSats ? undefined : amt
    )
  }

  if (destination.kind === 'keysend') {
    if (amountSats === null || amountSats <= 0)
      throw new PaymentInputError('amountRequired', 'Enter an amount')
    return payKeysend(nwcString, destination.pubkey, amountSats)
  }

  if (destination.kind === 'lnurl-pay') {
    if (amountSats === null || amountSats <= 0)
      throw new PaymentInputError('amountRequired', 'Enter an amount')
    return payLnurl(
      nwcString,
      {
        lnurlpUrl: destination.lnurlpUrl,
        address: 'address' in destination ? destination.address : null
      },
      amountSats,
      comment
    )
  }

  throw new PaymentInputError(
    'npubUnsupported',
    'Zaps to npubs are not supported yet'
  )
}

/** Test-only. */
export function __resetWalletMethodsForTests(): void {
  walletMethods.clear()
}
