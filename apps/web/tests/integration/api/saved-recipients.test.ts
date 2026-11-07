import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

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

import * as route from '@/app/api/wallet/recipients/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { AuthenticationError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'

const path = '/api/wallet/recipients'
const usedAt = new Date('2026-11-06T12:00:00.000Z')

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

describe('saved recipients', () => {
  it('lists only the caller’s recipients, most recent first and capped', async () => {
    vi.mocked(prismaMock.savedRecipient.findMany).mockResolvedValue([
      {
        lightningAddress: 'alice@example.com',
        name: 'Alice',
        avatarUrl: null,
        lastUsedAt: usedAt
      }
    ] as never)
    const response = await route.GET(
      createNextRequest(`${path}?userId=someone-else`)
    )
    expect(await assertResponse(response, 200)).toEqual({
      recipients: [
        {
          lightningAddress: 'alice@example.com',
          name: 'Alice',
          avatarUrl: null,
          lastUsedAt: usedAt.toISOString()
        }
      ]
    })
    expect(prismaMock.savedRecipient.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner' },
      orderBy: { lastUsedAt: 'desc' },
      take: 50,
      select: {
        lightningAddress: true,
        name: true,
        avatarUrl: true,
        lastUsedAt: true
      }
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
        createNextRequest(path, {
          method,
          body: { lightningAddress: 'alice@example.com' }
        })
      )
      expect(response.status).toBe(401)
      expect(prismaMock.savedRecipient.findMany).not.toHaveBeenCalled()
      expect(prismaMock.savedRecipient.upsert).not.toHaveBeenCalled()
    }
  )

  it('upserts a normalized address under the authenticated account and bumps lastUsedAt', async () => {
    vi.useFakeTimers({ now: usedAt })
    try {
      const response = await route.PUT(
        createNextRequest(path, {
          method: 'PUT',
          body: {
            lightningAddress: '  Alice@Example.COM ',
            name: ' Alice ',
            avatarUrl: 'https://img.example.com/a.png',
            userId: 'x'
          }
        })
      )
      expect(await assertResponse(response, 200)).toEqual({
        lightningAddress: 'alice@example.com'
      })
      const data = {
        name: 'Alice',
        avatarUrl: 'https://img.example.com/a.png',
        lastUsedAt: usedAt
      }
      expect(prismaMock.savedRecipient.upsert).toHaveBeenCalledWith({
        where: {
          userId_lightningAddress: {
            userId: 'owner',
            lightningAddress: 'alice@example.com'
          }
        },
        create: {
          userId: 'owner',
          lightningAddress: 'alice@example.com',
          ...data
        },
        update: data
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps stored name and avatar when the upsert omits them', async () => {
    await route.PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { lightningAddress: 'alice@example.com' }
      })
    )
    const call = vi.mocked(prismaMock.savedRecipient.upsert).mock.calls[0][0]
    expect(call.update).not.toHaveProperty('name')
    expect(call.update).not.toHaveProperty('avatarUrl')
    expect(call.update).toHaveProperty('lastUsedAt')
  })

  it.each([
    { lightningAddress: 'not-an-address' },
    { lightningAddress: `${'a'.repeat(190)}@example.com` },
    { lightningAddress: 'alice@example.com', name: 'x'.repeat(81) },
    { lightningAddress: 'alice@example.com', avatarUrl: 'javascript:alert(1)' },
    { lightningAddress: 42 },
    {}
  ])('rejects invalid payloads (%j)', async body => {
    const response = await route.PUT(
      createNextRequest(path, { method: 'PUT', body })
    )
    expect(response.status).toBe(400)
    expect(prismaMock.savedRecipient.upsert).not.toHaveBeenCalled()
  })
})
