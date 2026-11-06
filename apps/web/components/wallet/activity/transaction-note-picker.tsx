'use client'

import { useId, useState, type FormEvent, type MouseEvent } from 'react'
import { StickyNote } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { useApi, invalidateApiPath } from '@/lib/client/hooks/use-api'
import { TRANSACTION_NOTE_MAX_LENGTH } from '@lawallet-nwc/shared'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Tiny note button under the amount; opens a short private-note field. */
export function TransactionNotePicker({
  paymentHash,
  note,
  fallbackComment,
  onSaved
}: {
  paymentHash: string
  note?: string | null
  /** Original payment comment used to prefill when no override is saved. */
  fallbackComment?: string | null
  onSaved: (note: string | null) => void
}) {
  const { apiClient } = useAuth()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const inputId = useId()
  const errorId = useId()
  const path = `/api/wallet/transactions/${paymentHash}/note`
  const current = useApi<{ note: string | null }>(open ? path : null)
  const unavailable = current.loading || !current.data || Boolean(current.error)
  const loadedOverride = current.data?.note ?? ''
  const hasOverride = Boolean(loadedOverride)
  const prefill = loadedOverride || fallbackComment || ''
  const value = draft ?? prefill

  async function save(next: string) {
    if (saving || unavailable) return
    setSaving(true)
    setSaveError('')
    try {
      const saved = await apiClient.put<{ note: string | null }>(path, {
        note: next
      })
      invalidateApiPath(path)
      onSaved(saved.note)
      setOpen(false)
      setDraft(null)
    } catch {
      setSaveError('Could not save note. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void save(value.trim())
  }

  function stopRowNavigation(event: MouseEvent) {
    event.stopPropagation()
  }

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        if (saving) return
        setOpen(next)
        setDraft(null)
        setSaveError('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={note ? `Edit note: ${note}` : 'Add note'}
          title={note || 'Add note'}
          className="size-5 shrink-0 text-muted-foreground hover:text-foreground [&_svg]:size-3"
          onClick={stopRowNavigation}
          onPointerDown={stopRowNavigation}
        >
          <StickyNote
            aria-hidden="true"
            className={cn('size-3', note && 'fill-current')}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 max-w-[calc(100vw-2rem)] p-2"
        onClick={stopRowNavigation}
        onPointerDown={stopRowNavigation}
      >
        {current.error ? (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-sm text-destructive">
              Could not load note.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void current.refetch()}
            >
              Retry note
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <Field data-invalid={Boolean(saveError)}>
              <FieldLabel htmlFor={inputId}>Note</FieldLabel>
              <Input
                id={inputId}
                className="h-8"
                autoFocus
                value={value}
                placeholder={current.loading ? 'Loading…' : 'Private note'}
                maxLength={TRANSACTION_NOTE_MAX_LENGTH}
                disabled={saving || unavailable}
                aria-invalid={Boolean(saveError)}
                aria-describedby={errorId}
                onChange={event => {
                  setDraft(event.target.value)
                  setSaveError('')
                }}
              />
            </Field>
            <div className="flex justify-end gap-2">
              {hasOverride ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  disabled={saving || unavailable}
                  onClick={() => void save('')}
                >
                  Remove note
                </Button>
              ) : null}
              <Button
                type="submit"
                size="sm"
                className="h-8"
                disabled={
                  saving ||
                  unavailable ||
                  value.trim() === loadedOverride ||
                  (!hasOverride && value.trim() === (fallbackComment || ''))
                }
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>
        )}
        <FieldError id={errorId} role="alert">
          {saveError}
        </FieldError>
      </PopoverContent>
    </Popover>
  )
}
