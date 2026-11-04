/** Private free-text note, rendered as a small centered gray pill. */
export function TransactionNotePill({ note }: { note?: string | null }) {
  if (!note) return null
  return (
    <p
      data-testid="transaction-note"
      className="mx-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-full bg-neutral-600 px-3 py-0.5 text-center text-xs text-white"
    >
      {note}
    </p>
  )
}
