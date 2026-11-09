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
        lastUsedAt: usedAt,
        lastFailureReason: 'Pedile un invoice.',
        lastFailureAt: usedAt
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
          lastUsedAt: usedAt.toISOString(),
          lastFailureReason: 'Pedile un invoice.',
          lastFailureAt: usedAt.toISOString()
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
        lastUsedAt: true,
        lastFailureReason: true,
        lastFailureAt: true
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

  it.each(['alice@example.com', '02' + 'ab'.repeat(32)])(
    'persists and clears a failure for %s under the caller only',
    async lightningAddress => {
      for (const lastFailureReason of [
        'No se encontró ruta. Pedile un invoice.',
        null
      ]) {
        const response = await route.PUT(
          createNextRequest(path, {
            method: 'PUT',
            body: {
              lightningAddress,
              lastFailureReason,
              userId: 'other',
              lastFailureAt: '2000-01-01T00:00:00Z'
            }
          })
        )
        expect(response.status).toBe(200)
        const call = vi
          .mocked(prismaMock.savedRecipient.upsert)
          .mock.calls.at(-1)![0]
        expect(call.where).toEqual({
          userId_lightningAddress: { userId: 'owner', lightningAddress }
        })
        expect(call.create).toMatchObject({
          userId: 'owner',
          lightningAddress,
          lastFailureReason
        })
        expect(call.update).toMatchObject({
          lastFailureReason,
          lastFailureAt: lastFailureReason ? expect.any(Date) : null
        })
      }
    }
  )

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
    expect(call.update).not.toHaveProperty('lastFailureReason')
    expect(call.update).not.toHaveProperty('lastFailureAt')
    expect(call.update).toHaveProperty('lastUsedAt')
  })

  it.each([
    { lightningAddress: 'not-an-address' },
    { lightningAddress: `${'a'.repeat(190)}@example.com` },
    { lightningAddress: 'alice@example.com', name: 'x'.repeat(81) },
    { lightningAddress: 'alice@example.com', avatarUrl: 'javascript:alert(1)' },
    { lightningAddress: 42 },
    { lightningAddress: '02' + 'ab'.repeat(31) },
    {
      lightningAddress: 'alice@example.com',
      lastFailureReason: 'x'.repeat(501)
    },
    { lightningAddress: 'alice@example.com', lastFailureReason: '' },
    { lightningAddress: 'alice@example.com', lastFailureReason: 42 },
    {}
  ])('rejects invalid payloads (%j)', async body => {
    const response = await route.PUT(
      createNextRequest(path, { method: 'PUT', body })
    )
    expect(response.status).toBe(400)
    expect(prismaMock.savedRecipient.upsert).not.toHaveBeenCalled()
  })

  describe('POST (backfill from history)', () => {
    const older = '2026-10-01T10:00:00.000Z'

    it('inserts only missing addresses, keeping their own last-used time', async () => {
      vi.mocked(prismaMock.savedRecipient.createMany).mockResolvedValue({
        count: 2
      })
      const response = await route.POST(
        createNextRequest(path, {
          method: 'POST',
          body: {
            userId: 'x',
            recipients: [
              {
                lightningAddress: 'Ariel@LaCrypta.ar',
                name: 'Ariel',
                lastUsedAt: older
              },
              { lightningAddress: 'bob@example.com', lastUsedAt: older }
            ]
          }
        })
      )
      expect(await assertResponse(response, 200)).toEqual({ inserted: 2 })
      expect(prismaMock.savedRecipient.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'owner',
            lightningAddress: 'ariel@lacrypta.ar',
            name: 'Ariel',
            avatarUrl: null,
            lastUsedAt: new Date(older)
          },
          {
            userId: 'owner',
            lightningAddress: 'bob@example.com',
            name: null,
            avatarUrl: null,
            lastUsedAt: new Date(older)
          }
        ],
        skipDuplicates: true
      })
    })

    it('clamps a future last-used time to now', async () => {
      vi.useFakeTimers({ now: usedAt })
      try {
        await route.POST(
          createNextRequest(path, {
            method: 'POST',
            body: {
              recipients: [
                {
                  lightningAddress: 'bob@example.com',
                  lastUsedAt: '2099-01-01T00:00:00.000Z'
                }
              ]
            }
          })
        )
      } finally {
        vi.useRealTimers()
      }
      const call = vi.mocked(prismaMock.savedRecipient.createMany).mock
        .calls[0][0] as { data: Array<{ lastUsedAt: Date }> }
      expect(call.data[0].lastUsedAt).toEqual(usedAt)
    })

    it('requires authentication', async () => {
      vi.mocked(authenticate).mockRejectedValue(
        new AuthenticationError('Unauthorized')
      )
      const response = await route.POST(
        createNextRequest(path, {
          method: 'POST',
          body: {
            recipients: [
              { lightningAddress: 'bob@example.com', lastUsedAt: older }
            ]
          }
        })
      )
      expect(response.status).toBe(401)
      expect(prismaMock.savedRecipient.createMany).not.toHaveBeenCalled()
    })

    it.each([
      { recipients: [] },
      {
        recipients: Array.from({ length: 51 }, (_, i) => ({
          lightningAddress: `u${i}@example.com`,
          lastUsedAt: older
        }))
      },
      { recipients: [{ lightningAddress: 'nope', lastUsedAt: older }] },
      {
        recipients: [
          { lightningAddress: 'bob@example.com', lastUsedAt: 'yesterday' }
        ]
      }
    ])('rejects invalid batches (%#)', async body => {
      const response = await route.POST(
        createNextRequest(path, { method: 'POST', body })
      )
      expect(response.status).toBe(400)
      expect(prismaMock.savedRecipient.createMany).not.toHaveBeenCalled()
    })
  })
})
