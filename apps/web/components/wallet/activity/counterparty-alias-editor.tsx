'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import { COUNTERPARTY_ALIASES_PATH } from '@/lib/client/hooks/use-counterparty-aliases'
import { COUNTERPARTY_ALIAS_MAX_LENGTH } from '@lawallet-nwc/shared'
import { cn } from '@/lib/utils'

/**
 * Inline editor for a counterparty alias. Enter/blur save, Escape cancels,
 * empty value removes the alias (title falls back to recipient / node id).
 * Must sit outside the row <Link> so taps do not navigate.
 */
export function CounterpartyAliasEditor({
  counterpartyKey,
  alias,
  defaultLabel,
  onSaved,
  className,
  full = false
}: {
  counterpartyKey: string
  alias?: string | null
  /** Recipient name/address or abbreviated node id (shown when no alias). */
  defaultLabel: string
  onSaved: (alias: string | null) => void
  className?: string
  /** Show the full default label (detail screen) instead of truncating. */
  full?: boolean
}) {
  const { apiClient } = useAuth()
  const display = alias || defaultLabel
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const done = useRef(false)

  function start() {
    done.current = false
    setDraft(alias || '')
    setError('')
    setEditing(true)
  }

  async function commit() {
    if (done.current || saving) return
    done.current = true
    const next = draft.trim()
    if (next === (alias || '')) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const saved = await apiClient.put<{ key: string; alias: string | null }>(
        COUNTERPARTY_ALIASES_PATH,
        { key: counterpartyKey, alias: next }
      )
      invalidateApiPath(COUNTERPARTY_ALIASES_PATH)
      onSaved(saved.alias)
      setEditing(false)
    } catch {
      done.current = false
      setError('Could not save alias')
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      done.current = true
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <span className={cn('flex min-w-0 flex-col', className)}>
        <input
          autoFocus
          aria-label="Counterparty alias"
          value={draft}
          maxLength={COUNTERPARTY_ALIAS_MAX_LENGTH}
          disabled={saving}
          placeholder={defaultLabel}
          aria-invalid={Boolean(error)}
          onChange={event => {
            setDraft(event.target.value)
            setError('')
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          className="h-5 w-full min-w-0 rounded border border-border bg-background px-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </span>
    )
  }

  return (
    <button
      type="button"
      aria-label={`Edit alias: ${display}`}
      onClick={start}
      className={cn(
        'min-w-0 max-w-full rounded text-left text-sm font-medium text-foreground hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        full ? 'break-all' : 'truncate',
        className
      )}
    >
      {display}
    </button>
  )
}
