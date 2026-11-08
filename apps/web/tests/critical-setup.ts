import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, vi } from 'vitest'
// Real storage/business modules, no global authenticated identity, Prisma or
// useApi mocks. Only explicit session/network boundary doubles per flow.
let unexpected: string[] = []
beforeEach(() => {
  unexpected = []
  vi.stubGlobal('fetch', (input: unknown) => {
    unexpected.push(String(input))
    throw new Error('Critical flow made an unconfigured network request')
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  expect(unexpected, 'Critical flows must stub every network boundary').toEqual(
    []
  )
})
