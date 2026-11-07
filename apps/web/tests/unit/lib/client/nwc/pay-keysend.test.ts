import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getNwcClient, getInfo, payKeysend, payInvoice } = vi.hoisted(() => ({
  getNwcClient: vi.fn(),
  getInfo: vi.fn(),
  payKeysend: vi.fn(),
  payInvoice: vi.fn()
}))

vi.mock('@/lib/client/nwc/nwc-client', () => ({ getNwcClient }))

import {
  PaymentInputError,
  payQuotedInvoice,
  quotePayment,
  __resetWalletMethodsForTests
} from '@/lib/client/nwc/pay'

const NWC = 'nostr+walletconnect://abc#def'
const PUBKEY = '02' + 'ab'.repeat(32)
const destination = { kind: 'keysend', pubkey: PUBKEY } as const
// sha256 of 32 zero bytes
const ZERO_PREIMAGE = '00'.repeat(32)
const ZERO_HASH =
  '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925'

beforeEach(() => {
  vi.clearAllMocks()
  __resetWalletMethodsForTests()
  getNwcClient.mockResolvedValue({ getInfo, payKeysend, payInvoice })
  getInfo.mockResolvedValue({ methods: ['pay_invoice', 'pay_keysend'] })
})

describe('keysend payments', () => {
  it('quotes a keysend for a wallet that supports it', async () => {
    const quote = await quotePayment(destination, 21, undefined, NWC)
    expect(quote).toMatchObject({
      amountSats: 21,
      keysendPubkey: PUBKEY,
      comment: null
    })
  })

  it('needs an amount', async () => {
    await expect(
      quotePayment(destination, null, undefined, NWC)
    ).rejects.toMatchObject({ code: 'amountRequired' })
  })

  it('refuses up front when the wallet does not offer pay_keysend', async () => {
    getInfo.mockResolvedValue({ methods: ['pay_invoice'] })
    const error = await quotePayment(destination, 21, undefined, NWC).catch(
      e => e
    )
    expect(error).toBeInstanceOf(PaymentInputError)
    expect(error.code).toBe('keysendUnsupported')
  })

  it('asks the wallet for its methods once per connection', async () => {
    await quotePayment(destination, 21, undefined, NWC)
    await quotePayment(destination, 42, undefined, NWC)
    expect(getInfo).toHaveBeenCalledTimes(1)
  })

  it('lets the payment try when the wallet cannot report its methods', async () => {
    getInfo.mockRejectedValue(new Error('timeout'))
    await expect(
      quotePayment(destination, 21, undefined, NWC)
    ).resolves.toMatchObject({ keysendPubkey: PUBKEY })
  })

  it('pays a keysend quote with pay_keysend in msats and derives the hash', async () => {
    payKeysend.mockResolvedValue({ preimage: ZERO_PREIMAGE, fees_paid: 2000 })
    const quote = await quotePayment(destination, 21, undefined, NWC)
    const result = await payQuotedInvoice(NWC, quote)
    expect(payKeysend).toHaveBeenCalledWith({ amount: 21_000, pubkey: PUBKEY })
    expect(payInvoice).not.toHaveBeenCalled()
    expect(result).toEqual({
      preimage: ZERO_PREIMAGE,
      feesPaidSats: 2,
      paymentHash: ZERO_HASH
    })
  })
})
