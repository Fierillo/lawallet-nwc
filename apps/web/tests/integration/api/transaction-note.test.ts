import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))
vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

import * as route from '@/app/api/wallet/transactions/[paymentHash]/note/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { AuthenticationError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'

const hash = 'a'.repeat(64)
const path = `/api/wallet/transactions/${hash}/note`

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: 'b'.repeat(64),
    role: Role.USER,
    method: 'jwt'
  })
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'owner'
  } as never)
})

describe('private transaction note', () => {
  it('returns null for a transaction without a note', async () => {
    vi.mocked(prismaMock.transactionNote.findUnique).mockResolvedValue(null)
    expect(
      await assertResponse(
        await route.GET(
          createNextRequest(path),
          createParamsPromise({ paymentHash: hash })
        ),
        200
      )
    ).toEqual({ note: null })
  })

  it('reloads only the caller’s persisted note', async () => {
    vi.mocked(prismaMock.transactionNote.findUnique).mockResolvedValue({
      note: 'Paid back Ana'
    } as never)
    const response = await route.GET(
      createNextRequest(`${path}?userId=someone-else`),
      createParamsPromise({ paymentHash: hash })
    )
    expect(await assertResponse(response, 200)).toEqual({
      note: 'Paid back Ana'
    })
    expect(prismaMock.transactionNote.findUnique).toHaveBeenCalledWith({
      where: { userId_paymentHash: { userId: 'owner', paymentHash: hash } },
      select: { note: true }
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it.each(['GET', 'PUT'] as const)(
    'requires authentication for %s',
    async method => {
      vi.mocked(authenticate).mockRejectedValue(
        new AuthenticationError('Unauthorized')
      )
      const response = await route[method](
        createNextRequest(path, { method, body: { note: 'x' } }),
        createParamsPromise({ paymentHash: hash })
      )
      expect(response.status).toBe(401)
      expect(prismaMock.transactionNote.findUnique).not.toHaveBeenCalled()
      expect(prismaMock.transactionNote.upsert).not.toHaveBeenCalled()
    }
  )

  it('persists a trimmed note only under the authenticated account', async () => {
    const response = await route.PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { note: '  Dinner with Ana  ', userId: 'someone-else' }
      }),
      createParamsPromise({ paymentHash: hash })
    )
    expect(await assertResponse(response, 200)).toEqual({
      note: 'Dinner with Ana'
    })
    expect(prismaMock.transactionNote.upsert).toHaveBeenCalledWith({
      where: { userId_paymentHash: { userId: 'owner', paymentHash: hash } },
      create: { userId: 'owner', paymentHash: hash, note: 'Dinner with Ana' },
      update: { note: 'Dinner with Ana' }
    })
  })

  it('accepts a 280-character note', async () => {
    const response = await route.PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { note: 'x'.repeat(280) }
      }),
      createParamsPromise({ paymentHash: hash })
    )
    expect(response.status).toBe(200)
  })

  it.each(['x'.repeat(281), 42, null, { note: 'hidden' }])(
    'rejects invalid notes (%j)',
    async note => {
      const response = await route.PUT(
        createNextRequest(path, { method: 'PUT', body: { note } }),
        createParamsPromise({ paymentHash: hash })
      )
      expect(response.status).toBe(400)
      expect(prismaMock.transactionNote.upsert).not.toHaveBeenCalled()
    }
  )

  it.each(['GET', 'PUT'] as const)(
    'rejects malformed transaction hashes for %s',
    async method => {
      const response = await route[method](
        createNextRequest(path, { method, body: { note: 'x' } }),
        createParamsPromise({ paymentHash: 'not-a-payment-hash' })
      )
      expect(response.status).toBe(400)
    }
  )

  it('clears the caller’s note when saved empty', async () => {
    vi.mocked(prismaMock.transactionNote.deleteMany).mockResolvedValue({
      count: 1
    })
    const response = await route.PUT(
      createNextRequest(path, { method: 'PUT', body: { note: '   ' } }),
      createParamsPromise({ paymentHash: hash })
    )
    expect(await assertResponse(response, 200)).toEqual({ note: null })
    expect(prismaMock.transactionNote.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', paymentHash: hash }
    })
    expect(prismaMock.transactionNote.upsert).not.toHaveBeenCalled()
  })
})
