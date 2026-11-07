import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { __resetContactsCacheForTests } from '@/lib/client/contacts-store'
import { RecipientInput } from '@/components/wallet/send/recipient-input'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

const { apiPut, serverRecipients } = vi.hoisted(() => ({
  apiPut: vi.fn(),
  serverRecipients: { current: [] as unknown[] }
}))

vi.mock('@/lib/client/hooks/use-api', () => ({
  useApi: (path: string | null) => ({
    data:
      path === '/api/wallet/recipients'
        ? { recipients: serverRecipients.current }
        : { lightningAddress: 'me@lawallet.io' }
  })
}))

vi.mock('@/components/admin/auth-context', () => ({
  useAuth: () => ({ apiClient: { put: apiPut } })
}))

function seedContacts(count: number) {
  const contacts = Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `user${i}`,
    lightningAddress: `user${i}@lawallet.io`,
    createdAt: 1000 - i
  }))
  window.localStorage.setItem('lawallet-contacts', JSON.stringify(contacts))
  __resetContactsCacheForTests()
}

describe('RecipientInput', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
    serverRecipients.current = []
    apiPut.mockReset().mockResolvedValue({})
    // The list hydrates NIP-05 profiles on mount — keep it off the network.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 }))
    )
  })

  it('disables native browser autocomplete', () => {
    render(<RecipientInput />)
    expect(screen.getByRole('combobox')).toHaveAttribute('autocomplete', 'off')
  })

  it('shows at most the last 10 recipients when the input is empty', () => {
    seedContacts(12)
    render(<RecipientInput />)
    expect(screen.getByRole('group', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(10)
  })

  it('hides unmatched recents once the user types a new local-part', async () => {
    const user = userEvent.setup()
    seedContacts(12)
    render(<RecipientInput />)

    await user.type(screen.getByRole('combobox'), 'satoshi')

    expect(screen.queryByRole('group', { name: 'Saved' })).toBeNull()
    expect(
      screen.getByRole('group', { name: 'Suggestions' })
    ).toBeInTheDocument()
    for (const option of screen.getAllByRole('option')) {
      expect(option.textContent).toContain('satoshi@')
    }
  })

  it('keeps a stored recipient and domain completions when typing its local-part', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(
      'lawallet-contacts',
      JSON.stringify([
        {
          id: 'c-fierillo',
          name: 'fierillo',
          lightningAddress: 'fierillo@lawallet.io',
          createdAt: 1
        }
      ])
    )
    __resetContactsCacheForTests()
    render(<RecipientInput />)

    await user.type(screen.getByRole('combobox'), 'fierillo')

    const saved = screen.getByRole('group', { name: 'Saved' })
    expect(saved).toHaveTextContent('fierillo@lawallet.io')

    const suggestions = screen.getByRole('group', { name: 'Suggestions' })
    expect(suggestions).toHaveTextContent('fierillo@lawallet.io')
    expect(suggestions).toHaveTextContent('fierillo@blink.sv')
  })

  it('shows a spinner while the next screen loads', async () => {
    const user = userEvent.setup()
    render(<RecipientInput />)

    await user.type(screen.getByRole('combobox'), 'satoshi@lawallet.ar')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByRole('status', { name: 'Loading next screen' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
  })

  it('suggests recipients saved on the account from other devices', () => {
    serverRecipients.current = [
      {
        lightningAddress: 'carol@blink.sv',
        name: 'Carol',
        avatarUrl: null,
        lastUsedAt: '2026-11-06T12:00:00.000Z'
      }
    ]
    render(<RecipientInput />)
    expect(screen.getByRole('group', { name: 'Saved' })).toHaveTextContent(
      'carol@blink.sv'
    )
  })

  it('saves a used Lightning Address on the account', async () => {
    const user = userEvent.setup()
    render(<RecipientInput />)

    await user.type(screen.getByRole('combobox'), 'satoshi@lawallet.ar')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(apiPut).toHaveBeenCalledWith('/api/wallet/recipients', {
      lightningAddress: 'satoshi@lawallet.ar',
      name: 'satoshi',
      avatarUrl: null
    })
  })

  it('keeps going when saving on the account fails', async () => {
    const user = userEvent.setup()
    apiPut.mockRejectedValue(new Error('offline'))
    render(<RecipientInput />)

    await user.type(screen.getByRole('combobox'), 'satoshi@lawallet.ar')
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(
      screen.getByRole('status', { name: 'Loading next screen' })
    ).toBeInTheDocument()
  })
})
