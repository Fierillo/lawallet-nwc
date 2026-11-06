'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { invalidateApiPath } from '@/lib/client/hooks/use-api'
import { TRANSACTION_NOTE_MAX_LENGTH } from '@lawallet-nwc/shared'
import { cn } from '@/lib/utils'

/**
 * The comment line doubles as the private note: tap the text to edit it in
 * place, or the round "+" when there is none. Empty value reverts to the
 * original payment comment.
 */
export function TransactionNoteEditor({
  paymentHash,
  note,
  originalComment,
  onSaved,
  quoted = false,
  className
}: {
  paymentHash: string
  note?: string | null
  originalComment?: string | null
  onSaved: (note: string | null) => void
  quoted?: boolean
  className?: string
}) {
  const { apiClient } = useAuth()
  const display = note || originalComment || ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const done = useRef(false)

  function start() {
    done.current = false
    setDraft(display)
    setError('')
    setEditing(true)
  }

  async function commit() {
    if (done.current || saving) return
    done.current = true
    const next = draft.trim()
    if (next === display || (!note && next === (originalComment || ''))) {
      setEditing(false)
      return
    }
    setSaving(true)
    const path = `/api/wallet/transactions/${paymentHash}/note`
    try {
      const saved = await apiClient.put<{ note: string | null }>(path, {
        note: next
      })
      invalidateApiPath(path)
      onSaved(saved.note)
      setEditing(false)
    } catch {
      done.current = false
      setError('Could not save note')
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
          aria-label="Note"
          value={draft}
          maxLength={TRANSACTION_NOTE_MAX_LENGTH}
          disabled={saving}
          placeholder="Private note"
          aria-invalid={Boolean(error)}
          onChange={event => {
            setDraft(event.target.value)
            setError('')
          }}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
          className="h-5 w-full min-w-0 rounded border border-border bg-background px-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {error ? (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </span>
    )
  }

  if (!display) {
    return (
      <button
        type="button"
        aria-label="Add note"
        title="Add note"
        onClick={start}
        className={cn(
          'flex size-4 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className
        )}
      >
        <Plus aria-hidden="true" className="size-3" />
      </button>
    )
  }

  return (
    <button
      type="button"
      aria-label={`Edit note: ${display}`}
      onClick={start}
      className={cn(
        'min-w-0 max-w-full truncate rounded text-left text-xs text-foreground/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
    >
      {quoted ? `“${display}”` : display}
    </button>
  )
}
