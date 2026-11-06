'use client'

import { useApi } from '@/lib/client/hooks/use-api'
import { isActivityPreviewRequested } from '@/lib/client/activity-detail'

const PATH = '/api/wallet/counterparty-aliases'

export function useCounterpartyAliases(): {
  aliases: Record<string, string>
  get: (key: string | null | undefined) => string | null
} {
  const preview = isActivityPreviewRequested()
  const result = useApi<{ aliases: Record<string, string> }>(
    preview ? null : PATH
  )
  const aliases = result.data?.aliases ?? {}
  return {
    aliases,
    get: key => (key ? (aliases[key] ?? null) : null)
  }
}

export const COUNTERPARTY_ALIASES_PATH = PATH
