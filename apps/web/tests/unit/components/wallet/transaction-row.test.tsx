import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TransactionRow } from '@/components/wallet/shared/transaction-row'
import {
  recallActivityTx,
  __resetActivityDetailStoreForTests
} from '@/lib/client/activity-detail-store'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'
import {
  rememberPaymentDestination,
  __resetPaymentDestinationsForTests
} from '@/lib/client/payment-destinations'

const HASH = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'

const TX: NwcTransaction = {
  type: 'incoming',
  amountSats: 21000,
  feesPaidSats: 0,
  description: 'Coffee',
  paymentHash: HASH,
  preimage: null,
  settledAt: Date.now(),
  createdAt: Date.now()
}

describe('TransactionRow', () => {
  beforeEach(() => {
    __resetActivityDetailStoreForTests()
    window.localStorage.clear()
    __resetPaymentDestinationsForTests()
  })
  it('renders a link to the transaction detail when href is set', () => {
    render(
      <TransactionRow tx={TX} href={`/wallet/activity/${HASH}?from=home`} />
    )

    const link = screen.getByRole('link', { name: /Received, \+21,000 sats/ })
    expect(link).toHaveAttribute('href', `/wallet/activity/${HASH}?from=home`)
  })

  it('stashes the transaction so the detail screen can paint immediately', async () => {
    const user = userEvent.setup()
    render(<TransactionRow tx={TX} href={`/wallet/activity/${HASH}`} />)

    await user.click(screen.getByRole('link', { name: /Received/ }))

    expect(recallActivityTx(HASH)?.amountSats).toBe(21000)
  })

  it('shows Sent/Received as the title and keeps the LUD-16 comment', () => {
    render(
      <TransactionRow
        tx={{ ...TX, description: 'Payment to @bob: gracias!' }}
      />
    )

    expect(screen.getByText('Received')).toBeInTheDocument()
    expect(screen.queryByText('Payment to @bob')).not.toBeInTheDocument()
    expect(screen.getByText('“gracias!”')).toBeInTheDocument()
  })

  it('shows the remembered Lightning Address and comment for a send', () => {
    rememberPaymentDestination(HASH, {
      address: 'alice@example.com',
      name: 'Alice',
      avatarUrl: 'data:image/png;base64,AAAA',
      comment: 'for lunch'
    })
    render(
      <TransactionRow
        tx={{ ...TX, type: 'outgoing', description: 'Invoice from alice' }}
      />
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('“for lunch”')).toBeInTheDocument()
    expect(
      JSON.parse(
        window.localStorage.getItem('lawallet-payment-destinations') ?? '{}'
      )[HASH].avatarUrl
    ).toBeNull()
  })

  it('prefers a private note override over the payment comment', () => {
    render(
      <TransactionRow
        tx={{ ...TX, description: 'Payment to @bob: gracias!' }}
        noteOverride="Split dinner"
      />
    )
    expect(screen.getByText('“Split dinner”')).toBeInTheDocument()
    expect(screen.queryByText('“gracias!”')).not.toBeInTheDocument()
  })

  it('renders the comment slot outside the row link (overlay link)', () => {
    render(
      <TransactionRow
        tx={TX}
        href={`/wallet/activity/${HASH}`}
        commentSlot={<button type="button">Add note</button>}
      />
    )
    const link = screen.getByRole('link', { name: /Received/ })
    expect(
      link.contains(screen.getByRole('button', { name: 'Add note' }))
    ).toBe(false)
    expect(link).toHaveAttribute('href', `/wallet/activity/${HASH}`)
  })

  it('renders the title slot outside the row link so alias edits do not navigate', () => {
    render(
      <TransactionRow
        tx={TX}
        href={`/wallet/activity/${HASH}`}
        titleSlot={<button type="button">Edit alias</button>}
      />
    )
    const link = screen.getByRole('link', { name: /Received/ })
    expect(
      link.contains(screen.getByRole('button', { name: 'Edit alias' }))
    ).toBe(false)
  })

  it('prefers a counterparty alias over the remembered destination name', () => {
    rememberPaymentDestination(HASH, {
      address: 'alice@example.com',
      name: 'Alice',
      avatarUrl: null,
      comment: null
    })
    render(
      <TransactionRow
        tx={{ ...TX, type: 'outgoing', description: 'Invoice from alice' }}
        aliasOverride="Ana"
      />
    )
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
  })

  it('does not use the invoice description as the title', () => {
    render(
      <TransactionRow
        tx={{
          ...TX,
          type: 'outgoing',
          description: 'Envío de BTC a alguien'
        }}
      />
    )
    expect(screen.getByText('Sent')).toBeInTheDocument()
    expect(screen.queryByText(/Envío de BTC/)).not.toBeInTheDocument()
  })
})

  it('shows the routing fee under the amount for outgoing payments', () => {
    render(
      <TransactionRow
        tx={{
          ...TX,
          type: 'outgoing',
          feesPaidSats: 3,
          feesPaidMsats: 3_000,
          description: ''
        }}
      />
    )
    const fee = screen.getByText('fee: 3 sats')
    expect(fee).toHaveClass('text-red-500')
    expect(fee.className).toMatch(/text-\[9px\]/)
    expect(screen.queryByText(/comisi/i)).not.toBeInTheDocument()
  })

  it('shows <1 sat when the fee is a positive sub-sat amount', () => {
    render(
      <TransactionRow
        tx={{
          ...TX,
          type: 'outgoing',
          feesPaidSats: 0,
          feesPaidMsats: 500,
          description: ''
        }}
      />
    )
    expect(screen.getByText('fee: <1 sats')).toHaveClass('text-red-500')
  })

  it('hides the fee line for incoming payments and zero fees', () => {
    const { rerender } = render(
      <TransactionRow
        tx={{ ...TX, type: 'incoming', feesPaidSats: 3, feesPaidMsats: 3_000 }}
      />
    )
    expect(screen.queryByText(/^(<1|\d+) sats$/)).not.toBeInTheDocument()

    rerender(
      <TransactionRow
        tx={{
          ...TX,
          type: 'outgoing',
          feesPaidSats: 0,
          feesPaidMsats: 0,
          description: ''
        }}
      />
    )
    expect(screen.queryByText(/^(<1|\d+) sats$/)).not.toBeInTheDocument()
  })
