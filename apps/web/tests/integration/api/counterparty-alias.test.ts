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

import * as route from '@/app/api/wallet/counterparty-aliases/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { AuthenticationError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'

const path = '/api/wallet/counterparty-aliases'
const lnKey = 'ln:alice@example.com'
const nodeKey = 'node:02' + 'ab'.repeat(32)

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

describe('counterparty aliases', () => {
  it('lists only the caller’s aliases as a key map', async () => {
    vi.mocked(prismaMock.counterpartyAlias.findMany).mockResolvedValue([
      { key: lnKey, alias: 'Ana' }
    ] as never)
    const response = await route.GET(
      createNextRequest(`${path}?userId=someone-else`)
    )
    expect(await assertResponse(response, 200)).toEqual({
      aliases: { [lnKey]: 'Ana' }
    })
    expect(prismaMock.counterpartyAlias.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner' },
      select: { key: true, alias: true }
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
          body: { key: lnKey, alias: 'Ana' }
        })
      )
      expect(response.status).toBe(401)
      expect(prismaMock.counterpartyAlias.findMany).not.toHaveBeenCalled()
      expect(prismaMock.counterpartyAlias.upsert).not.toHaveBeenCalled()
    }
  )

  it('persists a trimmed alias only under the authenticated account', async () => {
    const response = await route.PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { key: 'LN:Alice@Example.com', alias: '  Ana  ', userId: 'x' }
      })
    )
    expect(await assertResponse(response, 200)).toEqual({
      key: lnKey,
      alias: 'Ana'
    })
    expect(prismaMock.counterpartyAlias.upsert).toHaveBeenCalledWith({
      where: { userId_key: { userId: 'owner', key: lnKey } },
      create: { userId: 'owner', key: lnKey, alias: 'Ana' },
      update: { alias: 'Ana' }
    })
  })

  it('accepts a node pubkey key and a 40-character alias', async () => {
    const response = await route.PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { key: nodeKey, alias: 'x'.repeat(40) }
      })
    )
    expect(response.status).toBe(200)
  })

  it('accepts a counterparty key at the 200-character database limit', async () => {
    const key = `ln:${'a'.repeat(185)}@example.com`
    expect(key).toHaveLength(200)
    const response = await route.PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { key, alias: 'Ana' }
      })
    )
    expect(response.status).toBe(200)
  })

  it.each([
    { key: lnKey, alias: 'x'.repeat(41) },
    { key: 'ln:not-an-address', alias: 'Ana' },
    { key: `ln:${'a'.repeat(186)}@example.com`, alias: 'Ana' },
    { key: 'node:zz', alias: 'Ana' },
    { key: lnKey, alias: 42 },
    { alias: 'Ana' }
  ])('rejects invalid payloads (%j)', async body => {
    const response = await route.PUT(
      createNextRequest(path, { method: 'PUT', body })
    )
    expect(response.status).toBe(400)
    expect(prismaMock.counterpartyAlias.upsert).not.toHaveBeenCalled()
  })

  it('clears the caller’s alias when saved empty', async () => {
    vi.mocked(prismaMock.counterpartyAlias.deleteMany).mockResolvedValue({
      count: 1
    })
    const response = await route.PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { key: lnKey, alias: '   ' }
      })
    )
    expect(await assertResponse(response, 200)).toEqual({
      key: lnKey,
      alias: null
    })
    expect(prismaMock.counterpartyAlias.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', key: lnKey }
    })
    expect(prismaMock.counterpartyAlias.upsert).not.toHaveBeenCalled()
  })
})
