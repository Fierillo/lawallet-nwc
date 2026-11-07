import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { validateNip98, validateNip98QueryToken } from '@/lib/nip98'
import { resolveConfiguredApiUrl } from '@/lib/public-url'

vi.mock('@/lib/public-url', () => ({
  resolveConfiguredApiUrl: vi.fn(async () => 'https://production.example')
}))

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', 'preview')
  vi.stubEnv('VERCEL_URL', 'preview.example')
  vi.stubEnv('VERCEL_BRANCH_URL', 'branch.example')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function signedRequest(
  signedOrigin: string,
  headers: Record<string, string> = {},
  method = 'POST'
) {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', `${signedOrigin}/api/jwt`],
        ['method', method]
      ],
      content: ''
    },
    generateSecretKey()
  )
  return new Request('https://preview.example/api/jwt', {
    method,
    headers: {
      authorization: `Nostr ${btoa(JSON.stringify(event))}`,
      host: 'preview.example',
      ...headers
    }
  })
}

it('rejects a genuine foreign-site signature despite a forged forwarded host', async () => {
  await expect(
    validateNip98(
      signedRequest('https://unrelated.example', {
        'x-forwarded-host': 'unrelated.example',
        'x-forwarded-proto': 'https'
      })
    )
  ).rejects.toThrow()
})

it.each<Record<string, string>>([
  { host: 'unrelated.example' },
  { 'x-forwarded-host': 'unrelated.example' },
  { host: 'unrelated.example', 'x-forwarded-host': 'unrelated.example' }
])('rejects a foreign-site signature with forged headers %j', async headers => {
  await expect(
    validateNip98(signedRequest('https://unrelated.example', headers))
  ).rejects.toThrow()
})

it.each([
  'https://preview.example',
  'https://branch.example',
  'https://production.example'
])('accepts a genuine signature for trusted origin %s', async origin => {
  const result = await validateNip98(
    signedRequest(origin, {
      'x-forwarded-host': 'unrelated.example'
    })
  )
  expect(result.pubkey).toHaveLength(64)
})

it('does not trust an arbitrary request URL in Preview', async () => {
  const original = signedRequest('https://unrelated.example')
  await expect(
    validateNip98(
      new Request('https://unrelated.example/api/jwt', {
        method: original.method,
        headers: original.headers
      })
    )
  ).rejects.toThrow()
})

it('does not fall back to headers when Preview metadata is absent', async () => {
  vi.stubEnv('VERCEL_URL', '')
  vi.stubEnv('VERCEL_BRANCH_URL', '')
  await expect(
    validateNip98(signedRequest('https://preview.example'))
  ).rejects.toThrow()
})

it('fails closed when neither configured endpoint nor Preview metadata is available', async () => {
  vi.stubEnv('VERCEL_URL', '')
  vi.stubEnv('VERCEL_BRANCH_URL', '')
  vi.mocked(resolveConfiguredApiUrl).mockRejectedValueOnce(
    new Error('unavailable')
  )
  await expect(
    validateNip98(signedRequest('https://preview.example'))
  ).rejects.toThrow('No trusted Preview origin is configured')
})

it('still accepts pinned Preview metadata when settings are unavailable', async () => {
  vi.mocked(resolveConfiguredApiUrl).mockRejectedValueOnce(
    new Error('unavailable')
  )
  await expect(
    validateNip98(signedRequest('https://preview.example'))
  ).resolves.toHaveProperty('pubkey')
})

it('keeps production endpoint-only even when Preview metadata exists', async () => {
  vi.stubEnv('VERCEL_ENV', 'production')
  await expect(
    validateNip98(signedRequest('https://preview.example'))
  ).rejects.toThrow()
})

it('also rejects foreign origins for query-carried NIP-98 tokens', async () => {
  const request = signedRequest(
    'https://unrelated.example',
    {
      'x-forwarded-host': 'unrelated.example'
    },
    'GET'
  )
  const token = request.headers.get('authorization')!.slice('Nostr '.length)
  await expect(validateNip98QueryToken(request, token)).rejects.toThrow()
})
