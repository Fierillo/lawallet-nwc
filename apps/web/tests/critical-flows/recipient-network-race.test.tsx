import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecipientInput } from '@/components/wallet/send/recipient-input'
import { clearApiCache } from '@/lib/client/hooks/use-api'
import { readContacts } from '@/lib/client/contacts-store'
import {
  rememberPaymentDestination,
  readPaymentDestinations
} from '@/lib/client/payment-destinations'
import {
  ACCOUNT_A,
  ACCOUNT_B,
  deferred,
  paymentDestination,
  recipientSession
} from '@/tests/helpers/recipient-fixtures'
const { auth, navigate } = vi.hoisted(() => ({
  navigate: vi.fn(),
  auth: {
    status: 'authenticated',
    pubkey: '',
    role: 'USER',
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() }
  }
}))
vi.mock('@/components/admin/auth-context', () => ({ useAuth: () => auth }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: navigate }) }))

beforeEach(() => {
  navigate.mockClear()
  clearApiCache()
  localStorage.clear()
  recipientSession(null)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
  )
})
it('uses real useApi, storage and recipient component: a late A response never hydrates or syncs B', async () => {
  const delayed = deferred<{ recipients: object[] }>()
  const clientA = recipientApi(delayed.promise)
  const clientB = recipientApi()
  auth.pubkey = ACCOUNT_A
  auth.apiClient = clientA
  recipientSession(ACCOUNT_A)
  rememberPaymentDestination('a', paymentDestination())
  const view = render(<RecipientInput />)
  await waitFor(() =>
    expect(clientA.get).toHaveBeenCalledWith('/api/wallet/recipients')
  )
  auth.pubkey = ACCOUNT_B
  auth.apiClient = clientB
  act(() => {
    recipientSession(ACCOUNT_B)
    view.rerender(<RecipientInput />)
  })
  await waitFor(() =>
    expect(clientB.get).toHaveBeenCalledWith('/api/wallet/recipients')
  )
  await act(async () => {
    delayed.resolve({
      recipients: [
        {
          lightningAddress: 'secret-a@example.com',
          name: 'A secret',
          avatarUrl: null,
          lastUsedAt: new Date().toISOString()
        }
      ]
    })
    await delayed.promise
  })
  expect(readContacts()).toEqual([])
  expect(readPaymentDestinations()).toEqual({})
  expect(clientB.post).not.toHaveBeenCalled()
  expect(screen.queryByText('A secret')).not.toBeInTheDocument()
  act(() => {
    recipientSession(ACCOUNT_A)
  })
  expect(readPaymentDestinations().a.address).toBe('alice@example.com')
})

function recipientApi(recipients: unknown = { recipients: [] }) {
  return {
    get: vi.fn((path: string) =>
      Promise.resolve(path === '/api/wallet/recipients' ? recipients : {})
    ),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({})
  }
}

it.each([ACCOUNT_B, ACCOUNT_A])(
  'drops a late LNURL recipient submission from A after switching to %s',
  async owner => {
    const metadata = deferred<Response>()
    const fetchBoundary = vi.fn((url: string) =>
      url.includes('/.well-known/lnurlp/alice')
        ? metadata.promise
        : Promise.resolve(new Response(null, { status: 404 }))
    )
    vi.stubGlobal('fetch', fetchBoundary)
    const clientA = recipientApi()
    const clientB = recipientApi()
    auth.pubkey = ACCOUNT_A
    auth.apiClient = clientA
    recipientSession(ACCOUNT_A)
    const view = render(<RecipientInput />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'alice@example.com' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() =>
      expect(fetchBoundary).toHaveBeenCalledWith(
        'https://example.com/.well-known/lnurlp/alice',
        expect.any(Object)
      )
    )
    act(() => {
      recipientSession(ACCOUNT_B)
      auth.pubkey = ACCOUNT_B
      auth.apiClient = clientB
      if (owner === ACCOUNT_A) {
        recipientSession(ACCOUNT_A)
        auth.pubkey = ACCOUNT_A
        auth.apiClient = clientA
      }
      view.rerender(<RecipientInput />)
    })
    await act(async () => {
      metadata.resolve(
        new Response(
          JSON.stringify({
            metadata: JSON.stringify([['text/plain', 'Private A']])
          })
        )
      )
      await metadata.promise
    })
    expect(readContacts()).toEqual([])
    expect(clientA.put).not.toHaveBeenCalled()
    expect(clientB.put).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  }
)
