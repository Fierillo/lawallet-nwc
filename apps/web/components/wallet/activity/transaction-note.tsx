'use client'

import { useState, type FormEvent } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { useApi, invalidateApiPath } from '@/lib/client/hooks/use-api'
import { TRANSACTION_NOTE_MAX_LENGTH } from '@lawallet-nwc/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError
} from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { TransactionNotePill } from './transaction-note-pill'

interface NoteResponse {
  note: string | null
}

export function TransactionNote({ paymentHash }: { paymentHash: string }) {
  const { apiClient } = useAuth()
  const path = `/api/wallet/transactions/${encodeURIComponent(paymentHash)}/note`
  const { data, loading, error, refetch } = useApi<NoteResponse>(path)
  const [draft, setDraft] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null | undefined>()
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const current =
    savedNote === undefined ? (data?.note ?? '') : (savedNote ?? '')
  const value = draft ?? current
  const unavailable = loading || !data || Boolean(error)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || unavailable) return
    setSaving(true)
    setSaveError('')
    setMessage('')
    try {
      const saved = await apiClient.put<NoteResponse>(path, { note: value })
      setSavedNote(saved.note)
      setDraft(null)
      setMessage(saved.note ? 'Note saved' : 'Note removed')
      invalidateApiPath(path)
    } catch {
      setSaveError(
        'Could not save note. Your changes have not been saved. Try again.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mt-3">
      <Card>
        <CardContent className="flex flex-col gap-3">
          <TransactionNotePill note={current} />
          <Field data-invalid={Boolean(saveError)}>
            <FieldLabel htmlFor="transaction-note">Note</FieldLabel>
            <Textarea
              id="transaction-note"
              value={value}
              rows={2}
              maxLength={TRANSACTION_NOTE_MAX_LENGTH}
              disabled={unavailable || saving}
              aria-invalid={Boolean(saveError)}
              aria-describedby="transaction-note-description transaction-note-error"
              placeholder="Add a private note"
              onChange={event => {
                setDraft(event.target.value)
                setMessage('')
                setSaveError('')
              }}
            />
            <FieldDescription id="transaction-note-description">
              Only you can see this. Up to {TRANSACTION_NOTE_MAX_LENGTH}{' '}
              characters. Clear it to remove it.
            </FieldDescription>
            <FieldError
              id="transaction-note-error"
              role={error || saveError ? 'alert' : undefined}
            >
              {error
                ? 'Could not load your note. Try again before editing.'
                : saveError}
            </FieldError>
          </Field>
        </CardContent>
        <CardFooter className="gap-3">
          {error ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
            >
              Retry note
            </Button>
          ) : (
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={unavailable || saving || value.trim() === current}
            >
              {saving ? 'Saving…' : 'Save note'}
            </Button>
          )}
          <span role="status" className="text-sm text-muted-foreground">
            {message}
          </span>
        </CardFooter>
      </Card>
    </form>
  )
}
