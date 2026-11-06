'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { useLocale, useT, type Dict } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'
import {
  activityFeeAmountLabel,
  type NwcTransaction
} from '@/lib/client/nwc/transactions'
import { rememberActivityTx } from '@/lib/client/activity-detail-store'
import {
  splitPaymentDescription,
  useAddressAvatar,
  usePaymentDestination
} from '@/lib/client/payment-destinations'
import { resolveTransactionCounterparty } from '@/lib/client/transaction-counterparty'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface TransactionRowProps {
  tx: NwcTransaction
  href?: string
  className?: string
  /** Private note override shown instead of the payment comment when set. */
  noteOverride?: string | null
  /** Saved counterparty alias; applied on top of recipient / node id. */
  aliasOverride?: string | null
  /**
   * Replaces the comment line (e.g. inline note editor). When set with href,
   * the link becomes a full-row overlay so this control is not inside it.
   */
  commentSlot?: ReactNode
  /**
   * Replaces the title line (e.g. inline alias editor). Same overlay rules as
   * `commentSlot`.
   */
  titleSlot?: ReactNode
}

export function TransactionRow({
  tx,
  href,
  className,
  noteOverride,
  aliasOverride,
  commentSlot,
  titleSlot
}: TransactionRowProps) {
  const t = useT()
  const locale = useLocale()
  const incoming = tx.type === 'incoming'
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
  const timestamp = tx.settledAt ?? tx.createdAt
  // Outgoing Lightning Address sends are remembered locally at pay time;
  // everything else only has the invoice (and optional alias) to go on.
  const destination = usePaymentDestination(incoming ? null : tx.paymentHash)
  const described = splitPaymentDescription(tx.description)
  const counterparty = resolveTransactionCounterparty(
    tx,
    destination,
    aliasOverride
  )
  const title =
    counterparty.label ||
    (counterparty.fallback === 'received'
      ? t.shared.tx.received
      : t.shared.tx.sent)
  const originalComment = destination ? destination.comment : described.comment
  const comment = noteOverride || originalComment
  const avatarUrl = useAddressAvatar(
    destination?.address,
    destination?.avatarUrl
  )
  const interactiveSlots = Boolean(titleSlot || commentSlot)
  const feeAmount = incoming
    ? null
    : activityFeeAmountLabel(
        tx.feesPaidMsats ??
          (tx.feesPaidSats > 0 ? tx.feesPaidSats * 1000 : null)
      )

  function remember() {
    rememberActivityTx(tx)
  }

  const classNames = cn(
    'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60',
    className
  )

  const body = (
    <>
      {destination ? (
        <div className="relative shrink-0">
          <Avatar className="size-10 bg-card">
            {avatarUrl && (
              <AvatarImage src={avatarUrl} alt="" className="object-cover" />
            )}
            <AvatarFallback className="text-xs font-medium uppercase">
              {destination.address.slice(0, 2)}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-orange-500 text-background ring-2 ring-background">
            <Icon className="size-2.5" strokeWidth={3} />
          </span>
        </div>
      ) : (
        <div
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-full',
            incoming
              ? 'bg-green-500/10 text-green-500'
              : 'bg-orange-500/10 text-orange-500'
          )}
        >
          <Icon className="size-4" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {titleSlot ? (
          <span className="pointer-events-auto relative z-10 flex min-w-0">
            {titleSlot}
          </span>
        ) : (
          <span className="truncate text-sm font-medium text-foreground">
            {title}
          </span>
        )}
        {commentSlot ? (
          <span className="pointer-events-auto relative z-10 flex min-w-0">
            {commentSlot}
          </span>
        ) : comment ? (
          <span className="truncate text-xs text-foreground/80">
            “{comment}”
          </span>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {formatRelative(timestamp, t, locale)}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
        <div className="text-right">
          <span
            className={cn(
              'text-sm font-semibold',
              incoming ? 'text-green-500' : 'text-foreground'
            )}
          >
            {incoming ? '+' : '−'}
            {tx.amountSats.toLocaleString()}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">sats</span>
        </div>
        {feeAmount ? (
          <span className="text-[10px] leading-tight text-red-500">
            {feeAmount} sats
          </span>
        ) : null}
      </div>
    </>
  )

  const linkLabel = `${title}, ${incoming ? '+' : '−'}${tx.amountSats.toLocaleString()} sats`

  if (href && interactiveSlots) {
    // Overlay link: title/note controls are siblings, never nested in the <a>.
    return (
      <div className={cn('relative', classNames)}>
        <Link
          href={href}
          prefetch={false}
          onClick={remember}
          onPointerDown={remember}
          aria-label={linkLabel}
          className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="pointer-events-none relative flex min-w-0 flex-1 items-center gap-3">
          {body}
        </div>
      </div>
    )
  }

  if (href) {
    return (
      <Link
        href={href}
        // Each row is a distinct dynamic route; viewport prefetch fired one
        // request per visible row (1.3k/day in Sentry). Detail is cheap to load.
        prefetch={false}
        onClick={remember}
        onPointerDown={remember}
        aria-label={linkLabel}
        className={classNames}
      >
        {body}
      </Link>
    )
  }

  return <div className={classNames}>{body}</div>
}

function formatRelative(ms: number, t: Dict, locale: string): string {
  const s = t.shared.tx
  const diff = Date.now() - ms
  if (diff < 0) return s.justNow
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return s.justNow
  if (minutes < 60) return s.minutesAgo(minutes)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return s.hoursAgo(hours)
  const days = Math.round(hours / 24)
  if (days < 7) return s.daysAgo(days)
  return new Date(ms).toLocaleDateString(locale)
}
