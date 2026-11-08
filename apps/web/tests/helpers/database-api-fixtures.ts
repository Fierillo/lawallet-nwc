import { createJwtToken } from '@/lib/jwt'
export const databaseTestSecret =
  'synthetic-test-only-jwt-secret-not-a-user-credential'
export const databaseTestConfig = {
  jwt: { enabled: true, secret: databaseTestSecret },
  maintenance: { enabled: false },
  requestLimits: { maxJsonSize: 100000 },
  isProduction: true,
  logPretty: false
}
export function databaseRequest(
  owner: string | null,
  method = 'GET',
  body?: object,
  signingSecret = databaseTestSecret
) {
  const token = owner
    ? createJwtToken(
        { userId: 'owner-a', pubkey: owner, role: 'USER' },
        signingSecret,
        { issuer: 'lawallet-nwc', audience: 'lawallet-users' }
      )
    : null
  return new Request(
    'https://walletilla.test/api/wallet/recipients?userId=owner-a',
    {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  )
}
