import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SendPreviewStep } from '@/components/wallet/send/preview-step'
import {
  contactsActions,
  readContactFailures,
  __resetContactsCacheForTests
} from '@/lib/client/contacts-store'
import {
  resetAllFlows,
  sendActions,
  useSendFlow
} from '@/lib/client/wallet-flow-store'
import { PaymentInputError, type PaymentQuote } from '@/lib/client/nwc/pay'

const replaceMock = vi.hoisted(() => vi.fn())
const quotePaymentMock = vi.hoisted(() => vi.fn())
const payQuotedInvoiceMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: replaceMock })
}))

vi.mock('@/lib/analytics/gtag', () => ({
  trackEvent: vi.fn()
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: () => ({
    data: {
      effectiveNwcString: 'nostr+walletconnect://test',
      nwcString: 'nostr+walletconnect://test'
    },
    loading: false,
    error: null,
    refetch: async () => undefined
  }),
  invalidateApiPath: vi.fn()
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({
    apiClient: { get: vi.fn(async () => undefined) }
  })
}))

vi.mock('@/lib/client/use-yadio-ticker', () => ({
  useYadioRates: () => ({
    rates: null,
    btcUsd: null,
    fetchedAt: null,
    loading: false,
    error: null
  }),
  convertSats: () => null
}))

vi.mock('@/lib/client/nwc', () => ({
  quotePayment: quotePaymentMock,
  payQuotedInvoice: payQuotedInvoiceMock
}))

const ADDRESS = 'satoshi@example.com'

function quote(comment: string | null): PaymentQuote {
  return {
    paymentRequest: 'lnbc1quote',
    amountSats: 1000,
    expiresAt: null,
    feeSats: null,
    feeQuoteStatus: 'unavailable',
    feeQuoteMessage: 'Fees arrive with settlement.',
    comment
  }
}

function ResultProbe() {
  const flow = useSendFlow()
  return (
    <div
      data-testid="send-result"
      data-comment={flow.result?.comment ?? ''}
      data-hash={flow.result?.paymentHash ?? ''}
      data-error={flow.error ?? ''}
    />
  )
}

describe('SendPreviewStep payer note', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    resetAllFlows()
    replaceMock.mockReset()
    quotePaymentMock.mockReset()
    payQuotedInvoiceMock.mockReset()
    payQuotedInvoiceMock.mockResolvedValue({
      preimage: 'ab',
      feesPaidSats: 2
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    )
    sendActions.setRecipient({
      raw: ADDRESS,
      destination: {
        kind: 'lnurl-pay',
        address: ADDRESS,
        username: 'satoshi',
        host: 'example.com',
        lnurlpUrl: 'https://example.com/.well-known/lnurlp/satoshi'
      }
    })
    sendActions.setAmount(1000)
    sendActions.setComment('Coffee')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('marks an address when resolving its LN payment request fails', async () => {
    quotePaymentMock.mockRejectedValue(
      new Error('No Lightning Address available')
    )
    render(<SendPreviewStep />)
    await screen.findByText('No Lightning Address available')
    expect(readContactFailures()[ADDRESS]).toBe(
      'No Lightning Address available'
    )
  })

  it('quotes with the note and shows it before paying', async () => {
    quotePaymentMock.mockResolvedValue(quote('Coffee'))
    render(<SendPreviewStep />)

    expect(await screen.findByText('Coffee')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    await waitFor(() => {
      expect(quotePaymentMock).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'lnurl-pay', address: ADDRESS }),
        1000,
        'Coffee',
        'nostr+walletconnect://test'
      )
    })
  })

  it('pays without the note when the recipient rejects it', async () => {
    const user = userEvent.setup()
    contactsActions.setPaymentFailure(ADDRESS, 'Fallo anterior')
    quotePaymentMock.mockResolvedValue(quote(null))
    render(
      <>
        <ResultProbe />
        <SendPreviewStep />
      </>
    )

    expect(
      await screen.findByText(
        'The recipient did not accept the note. This payment will be sent without it.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Coffee')).toBeNull()

    await user.click(screen.getByRole('button', { name: /Pay 1,000 sats/ }))

    await waitFor(() => {
      expect(screen.getByTestId('send-result')).toHaveAttribute(
        'data-comment',
        ''
      )
    })
    expect(payQuotedInvoiceMock).toHaveBeenCalledWith(
      'nostr+walletconnect://test',
      expect.objectContaining({ comment: null, paymentRequest: 'lnbc1quote' })
    )
    expect(replaceMock).toHaveBeenCalledWith('/wallet/send/summary')
    expect(readContactFailures()[ADDRESS]).toBeUndefined()
  })

  it('keeps the accepted note on the receipt', async () => {
    const user = userEvent.setup()
    quotePaymentMock.mockResolvedValue(quote('Coffee'))
    render(
      <>
        <ResultProbe />
        <SendPreviewStep />
      </>
    )

    await screen.findByRole('button', { name: /Pay 1,000 sats/ })
    await user.click(screen.getByRole('button', { name: /Pay 1,000 sats/ }))

    await waitFor(() => {
      expect(screen.getByTestId('send-result')).toHaveAttribute(
        'data-comment',
        'Coffee'
      )
    })
  })
})

describe('SendPreviewStep keysend', () => {
  const PUBKEY = '02' + 'ab'.repeat(32)

  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    resetAllFlows()
    replaceMock.mockReset()
    quotePaymentMock.mockReset()
    payQuotedInvoiceMock.mockReset()
    sendActions.setRecipient({
      raw: PUBKEY,
      destination: { kind: 'keysend', pubkey: PUBKEY },
      profile: { name: 'fiwi', image: null }
    })
    sendActions.setAmount(1000)
  })

  it('names the node by its alias and pays it, keeping the derived hash', async () => {
    const user = userEvent.setup()
    contactsActions.setPaymentFailure(PUBKEY, 'No se encontró ruta.')
    quotePaymentMock.mockResolvedValue({
      ...quote(null),
      paymentRequest: '',
      keysendPubkey: PUBKEY
    })
    payQuotedInvoiceMock.mockResolvedValue({
      preimage: 'ab',
      feesPaidSats: 0,
      paymentHash: 'cd'.repeat(32)
    })
    render(
      <>
        <ResultProbe />
        <SendPreviewStep />
      </>
    )

    expect(await screen.findByText('fiwi')).toBeInTheDocument()
    expect(screen.getAllByText('Lightning node').length).toBeGreaterThan(0)
    await user.click(
      await screen.findByRole('button', { name: /Pay 1,000 sats/ })
    )
    await waitFor(() => {
      expect(screen.getByTestId('send-result')).toHaveAttribute(
        'data-hash',
        'cd'.repeat(32)
      )
    })
    expect(readContactFailures()[PUBKEY]).toBeUndefined()
  })

  it('explains a missing route to the node in plain words', async () => {
    const user = userEvent.setup()
    quotePaymentMock.mockResolvedValue({
      ...quote(null),
      paymentRequest: '',
      keysendPubkey: PUBKEY
    })
    payQuotedInvoiceMock.mockRejectedValue(new Error('FAILURE_REASON_NO_ROUTE'))
    render(
      <>
        <ResultProbe />
        <SendPreviewStep />
      </>
    )

    await user.click(
      await screen.findByRole('button', { name: /Pay 1,000 sats/ })
    )
    await waitFor(() => {
      expect(screen.getByTestId('send-result')).toHaveAttribute(
        'data-error',
        'No route found to the node. Ask them for an invoice or a Lightning Address if they have one.'
      )
    })
    expect(readContactFailures()[PUBKEY]).toContain('No route')
  })

  it('explains when the wallet cannot keysend', async () => {
    quotePaymentMock.mockRejectedValue(
      new PaymentInputError('keysendUnsupported', 'nope')
    )
    render(<SendPreviewStep />)

    expect(
      await screen.findByText(/Your wallet can't pay a node directly/)
    ).toBeInTheDocument()
    expect(readContactFailures()[PUBKEY]).toContain('keysend')
  })
})
