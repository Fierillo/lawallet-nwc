'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Zap } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useApi } from '@/lib/client/hooks/use-api'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { useLightningAddressAvatar } from '@/lib/client/hooks/use-lightning-address-avatar'
import { readAvatar } from '@/lib/client/cache/avatar-cache'
import {
  contactsActions,
  useContacts,
  type Contact
} from '@/lib/client/contacts-store'
import {
  buildLightningAddressSuggestions,
  getDomainAvatarUrl,
  recipientMatchesQuery,
  resolveCurrentLightningDomain,
  type LightningAddressSuggestion
} from '@/lib/client/lightning-address-suggestions'
import { isLightningAddress } from '@/lib/ln-address'
import { COUNTERPARTY_ALIASES_PATH } from '@/lib/client/hooks/use-counterparty-aliases'
import {
  abbreviateNodePubkey,
  counterpartyLnKey
} from '@/lib/client/transaction-counterparty'
import { useT } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'

const RECENT_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RECENT_OPTIONS = 10
const AVATAR_LOOKUP_DEBOUNCE_MS = 400
const NAME_QUERY_RE = /^[a-z0-9._-]+(@[a-z0-9.-]*)?$/
const NON_ADDRESS_PREFIX_RE = /^(lnbc|lntb|lnbcrt|lnurl|npub|nprofile|0[23][0-9a-f]{64}$)/

interface UserMeResponse {
  lightningAddress: string | null
}

export interface LightningAddressInputProps {
  value: string
  onChange: (value: string) => void
  /** Fired when an option is picked, or Enter selects the highlighted one. */
  onSelect?: (address: string) => void
  /**
   * `inline` renders the option list as a full-height panel below the field —
   * the send screen, where the list IS the screen. `popover` floats it over
   * the page, which is what every in-form field needs.
   */
  variant?: 'inline' | 'popover'
  /**
   * Surfaces that also accept bolt11 / LNURL / npub. Only affects the trailing
   * "looks complete" avatar lookup; suggestion generation already declines to
   * suggest for those prefixes.
   */
  allowNonAddress?: boolean
  /** Hide the saved-contacts group, showing only generated suggestions. */
  hideContacts?: boolean
  /** Hide generated `name@domain` completions, showing only saved contacts. */
  hideSuggestions?: boolean
  /**
   * Also offer Lightning nodes the user aliased (picked as their pubkey, for
   * keysend). Only surfaces that can pay a node should set this.
   */
  allowNodes?: boolean
  id?: string
  name?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  className?: string
  inputRef?: React.Ref<HTMLInputElement>
  'aria-label'?: string
  onBlur?: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * One Lightning-address field for the whole app: saved recipients, generated
 * `username@domain` suggestions, avatars, and full combobox keyboard support.
 *
 * Controlled — the caller owns the value. Everything specific to a surface
 * (what happens on submit, whether a bolt11 is acceptable) stays at the call
 * site; this component only helps the user arrive at a string.
 */
export function LightningAddressInput({
  value,
  onChange,
  onSelect,
  variant = 'popover',
  allowNonAddress = false,
  hideContacts = false,
  hideSuggestions = false,
  allowNodes = false,
  id,
  name,
  placeholder = 'satoshi@lawallet.ar',
  disabled,
  invalid,
  autoFocus,
  className,
  inputRef,
  onBlur,
  onKeyDown,
  ...rest
}: LightningAddressInputProps) {
  const t = useT()
  const contacts = useContacts()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const { data: aliasData } = useApi<{ aliases?: Record<string, string> }>(
    hideContacts ? null : COUNTERPARTY_ALIASES_PATH
  )
  const aliasFor = (address: string): string | null =>
    aliasData?.aliases?.[counterpartyLnKey(address)] ?? null
  const [open, setOpen] = useState(variant === 'inline')
  const [focused, setFocused] = useState(false)
  const [highlightedOptionIndex, setHighlightedOptionIndex] = useState(-1)
  // The value last picked from the list. While the field still holds it the
  // choice is made, so the list gives way to the field alone.
  const [committedValue, setCommittedValue] = useState<string | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const localInputRef = useRef<HTMLInputElement | null>(null)
  // Unique per instance: the forwarding editor mounts several of these at once,
  // and a shared listbox id would produce duplicate DOM ids and point every
  // field's aria-controls at the same list.
  const reactId = useId()
  const listboxId = `lightning-address-options-${reactId}`

  const query = value.trim().toLowerCase()
  const committed = committedValue !== null && committedValue === query
  const currentDomain = resolveCurrentLightningDomain(me?.lightningAddress)

  // Addresses the user aliased in activity are people they know too, even
  // when this device never saved them. Node-id aliases have no address to
  // pay, so they stay out.
  const knownRecipients = useMemo(() => {
    if (hideContacts) return contacts
    const saved = new Set(contacts.map(c => c.lightningAddress))
    const aliasOnly: Contact[] = []
    for (const key of Object.keys(aliasData?.aliases ?? {})) {
      if (!key.startsWith('ln:')) continue
      const lightningAddress = key.slice(3)
      if (saved.has(lightningAddress) || !isLightningAddress(lightningAddress))
        continue
      aliasOnly.push({
        id: `alias:${lightningAddress}`,
        name: lightningAddress.split('@')[0] ?? lightningAddress,
        lightningAddress,
        createdAt: 0
      })
    }
    return aliasOnly.length > 0 ? [...contacts, ...aliasOnly] : contacts
  }, [aliasData, contacts, hideContacts])

  const recentContacts = useMemo(() => {
    if (hideContacts) return []
    const aliases = aliasData?.aliases
    const matched = query
      ? knownRecipients.filter(contact =>
          recipientMatchesQuery(
            {
              lightningAddress: contact.lightningAddress,
              names: [
                aliases?.[counterpartyLnKey(contact.lightningAddress)],
                contact.name,
                contact.displayName
              ]
            },
            query
          )
        )
      : knownRecipients
    return matched.slice(0, MAX_RECENT_OPTIONS)
  }, [aliasData, hideContacts, knownRecipients, query])
  const suggestedAddresses = useMemo(
    () =>
      hideSuggestions
        ? []
        : buildLightningAddressSuggestions(value, currentDomain),
    [currentDomain, hideSuggestions, value]
  )

  // Once the typed value IS one of the options, offering the other domains is
  // noise — the user already settled on one. Collapse to that single row, the
  // saved contact when there is one (it carries the avatar and name).
  const savedContact =
    knownRecipients.find(contact => contact.lightningAddress === query) ?? null
  const exactContact = hideContacts ? null : savedContact
  const exactSuggestion =
    suggestedAddresses.find(
      suggestion => suggestion.lightningAddress === query
    ) ?? null
  const exactMatch = exactContact ?? exactSuggestion

  const exactContacts = exactContact ? [exactContact] : []
  const exactSuggestions =
    !exactContact && exactSuggestion ? [exactSuggestion] : []
  const visibleContacts = committed
    ? []
    : exactMatch
      ? exactContacts
      : recentContacts
  const visibleNodes = useMemo(() => {
    if (!allowNodes || hideContacts || committed) return []
    const nodes: Array<{ pubkey: string; alias: string }> = []
    for (const [key, alias] of Object.entries(aliasData?.aliases ?? {})) {
      if (!key.startsWith('node:')) continue
      const pubkey = key.slice(5)
      if (
        query &&
        !recipientMatchesQuery(
          { lightningAddress: pubkey, names: [alias] },
          query
        )
      )
        continue
      nodes.push({ pubkey, alias })
    }
    return nodes.slice(0, MAX_RECENT_OPTIONS)
  }, [aliasData, allowNodes, committed, hideContacts, query])
  const visibleSuggestions = committed
    ? []
    : exactMatch
      ? exactSuggestions
      : suggestedAddresses

  const hasOptions =
    visibleContacts.length > 0 ||
    visibleNodes.length > 0 ||
    visibleSuggestions.length > 0
  const listVisible = hasOptions && (variant === 'inline' || open)

  const optionValues = [
    ...visibleContacts.map(contact => contact.lightningAddress),
    ...visibleNodes.map(node => node.pubkey),
    ...visibleSuggestions.map(suggestion => suggestion.lightningAddress)
  ]
  const activeOptionIndex =
    highlightedOptionIndex >= 0 && highlightedOptionIndex < optionValues.length
      ? highlightedOptionIndex
      : -1
  const activeOptionId =
    activeOptionIndex >= 0 ? optionId(listboxId, activeOptionIndex) : undefined

  // Only the finished address gets a real profile lookup — see the hook.
  const debouncedValue = useDebouncedValue(query, AVATAR_LOOKUP_DEBOUNCE_MS)
  const typedAvatar = useLightningAddressAvatar(
    !allowNonAddress || isLightningAddress(debouncedValue)
      ? debouncedValue
      : null
  )

  // Keep saved contacts' avatars warm, TTL-gated.
  useEffect(() => {
    if (hideContacts) return
    for (const contact of contacts.slice(0, MAX_RECENT_OPTIONS)) {
      if (
        contact.profileFetchedAt &&
        Date.now() - contact.profileFetchedAt < RECENT_PROFILE_TTL_MS
      ) {
        continue
      }
      void contactsActions.hydrateNip05Profile(contact.lightningAddress)
    }
  }, [contacts, hideContacts])

  useEffect(() => {
    if (activeOptionIndex < 0) return
    optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionIndex])

  // An exact match leaves exactly one row — highlight it, so Enter commits
  // without an extra ArrowDown.
  const exactMatchAddress = exactMatch?.lightningAddress ?? null
  useEffect(() => {
    if (exactMatchAddress) setHighlightedOptionIndex(0)
  }, [exactMatchAddress])

  function commit(nextValue: string) {
    onChange(nextValue)
    setCommittedValue(nextValue.trim().toLowerCase())
    setHighlightedOptionIndex(-1)
    if (variant === 'popover') setOpen(false)
    onSelect?.(nextValue)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e)
    if (e.defaultPrevented) return

    const optionCount = listVisible ? optionValues.length : 0

    if (e.key === 'ArrowDown' && optionCount > 0) {
      e.preventDefault()
      setOpen(true)
      setHighlightedOptionIndex(current =>
        nextOptionIndex(current, optionCount, 1)
      )
      return
    }

    if (e.key === 'ArrowUp' && optionCount > 0) {
      e.preventDefault()
      setOpen(true)
      setHighlightedOptionIndex(current =>
        nextOptionIndex(current, optionCount, -1)
      )
      return
    }

    if (e.key === 'Enter' && activeOptionIndex >= 0) {
      e.preventDefault()
      const selected = optionValues[activeOptionIndex]
      if (selected) commit(selected)
      return
    }

    if (e.key === 'Escape') {
      if (activeOptionIndex >= 0) {
        e.preventDefault()
        setHighlightedOptionIndex(-1)
        return
      }
      if (variant === 'popover' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
  }

  const optionList = listVisible ? (
    <section
      id={listboxId}
      role="listbox"
      aria-label={t.shared.addressInput.options}
      className={
        variant === 'inline'
          ? 'min-h-0 flex-1 overflow-hidden'
          : 'max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 shadow-lg'
      }
    >
      <div
        className={
          variant === 'inline'
            ? 'flex h-full flex-col gap-3 overflow-y-auto overscroll-y-contain pb-4 pr-1 scrollbar-gutter-stable'
            : 'flex flex-col gap-2'
        }
      >
        {(visibleContacts.length > 0 || visibleNodes.length > 0) && (
          <LightningAddressOptionGroup title={t.shared.addressInput.saved}>
            {visibleContacts.map((contact, index) => (
              <LightningAddressOptionButton
                key={contact.id}
                id={optionId(listboxId, index)}
                name={contact.lightningAddress}
                label={aliasFor(contact.lightningAddress)}
                avatarUrl={
                  contact.avatarUrl ??
                  getAvatarFallbackForAddress(contact.lightningAddress)
                }
                active={activeOptionIndex === index}
                buttonRef={node => {
                  optionRefs.current[index] = node
                }}
                onHighlight={() => setHighlightedOptionIndex(index)}
                onSelect={() => commit(contact.lightningAddress)}
                disabled={disabled}
              />
            ))}
            {visibleNodes.map((node, nodeIndex) => {
              const index = visibleContacts.length + nodeIndex
              return (
                <LightningAddressOptionButton
                  key={`node:${node.pubkey}`}
                  id={optionId(listboxId, index)}
                  name={abbreviateNodePubkey(node.pubkey)}
                  label={node.alias}
                  icon={<Zap className="size-3.5" aria-hidden />}
                  active={activeOptionIndex === index}
                  buttonRef={el => {
                    optionRefs.current[index] = el
                  }}
                  onHighlight={() => setHighlightedOptionIndex(index)}
                  onSelect={() => commit(node.pubkey)}
                  disabled={disabled}
                />
              )
            })}
          </LightningAddressOptionGroup>
        )}

        {visibleSuggestions.length > 0 && (
          <LightningAddressOptionGroup
            title={t.shared.addressInput.suggestions}
          >
            {visibleSuggestions.map((suggestion, index) => {
              const optionIndex =
                visibleContacts.length + visibleNodes.length + index
              // The exact typed address is the only one worth a real avatar.
              const resolved =
                typedAvatar.avatarUrl &&
                suggestion.lightningAddress === debouncedValue
                  ? typedAvatar.avatarUrl
                  : (knownAvatarFor(suggestion.lightningAddress, contacts) ??
                    suggestion.avatarUrl)
              return (
                <LightningAddressOptionButton
                  key={suggestion.lightningAddress}
                  id={optionId(listboxId, optionIndex)}
                  name={suggestion.lightningAddress}
                  avatarUrl={resolved}
                  active={activeOptionIndex === optionIndex}
                  buttonRef={node => {
                    optionRefs.current[optionIndex] = node
                  }}
                  onHighlight={() => setHighlightedOptionIndex(optionIndex)}
                  onSelect={() => commit(suggestion.lightningAddress)}
                  disabled={disabled}
                />
              )
            })}
          </LightningAddressOptionGroup>
        )}
      </div>
    </section>
  ) : null

  // A settled address: valid, and the user has moved on (or picked it). Show
  // who it is instead of leaving a bare string, and offer a way back to
  // editing. A saved contact's cached profile beats a fresh lookup.
  const settled = (!focused || committed) && isLightningAddress(query)
  const settledAvatarUrl = settled
    ? (knownAvatarFor(query, contacts) ??
      typedAvatar.avatarUrl ??
      getAvatarFallbackForAddress(query))
    : null
  const contactName = savedContact?.displayName ?? savedContact?.name
  // The default name is just the local-part — repeating it adds nothing.
  const settledName =
    settled && contactName && contactName !== query.split('@')[0]
      ? contactName
      : null

  const field = (
    <Input
      ref={node => {
        localInputRef.current = node
        if (typeof inputRef === 'function') inputRef(node)
        else if (inputRef) {
          ;(
            inputRef as React.MutableRefObject<HTMLInputElement | null>
          ).current = node
        }
      }}
      id={id}
      name={name}
      role="combobox"
      value={value}
      onChange={e => {
        // One place decides casing, so every surface agrees.
        onChange(e.target.value.toLowerCase())
        setHighlightedOptionIndex(-1)
        if (variant === 'popover') setOpen(true)
      }}
      onFocus={() => {
        setFocused(true)
        // Coming back to the field means editing, not the picked choice.
        setCommittedValue(null)
        if (variant === 'popover') setOpen(true)
      }}
      onBlur={() => {
        setFocused(false)
        // Let a click on an option land before the list unmounts.
        if (variant === 'popover') window.setTimeout(() => setOpen(false), 120)
        onBlur?.()
      }}
      onKeyDown={handleKeyDown}
      aria-autocomplete="list"
      aria-expanded={listVisible}
      aria-controls={listVisible ? listboxId : undefined}
      aria-activedescendant={activeOptionId}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete="off"
      data-1p-ignore
      data-lpignore="true"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      disabled={disabled}
      className={cn(
        invalid && 'border-destructive',
        settled && 'pl-11 pr-20',
        settledName && 'text-transparent',
        className
      )}
      aria-label={rest['aria-label']}
    />
  )

  // One stable wrapper, always rendered: switching between a bare input and a
  // wrapped one remounts the input, which drops focus mid-typing and orphans
  // the ref. Only the affordances come and go.
  const fieldWithAffordances = (
    <div className="group relative">
      {settled && (
        <Avatar className="pointer-events-none absolute left-2 top-1/2 size-7 -translate-y-1/2 border border-border/70">
          {settledAvatarUrl && (
            <AvatarImage
              src={settledAvatarUrl}
              alt=""
              className="object-cover"
            />
          )}
          <AvatarFallback className="text-[10px]">
            {initialsFor(query)}
          </AvatarFallback>
        </Avatar>
      )}
      {field}
      {settledName && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-11 right-20 flex flex-col justify-center leading-tight"
        >
          <span className="truncate text-sm font-medium text-foreground">
            {settledName}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {query}
          </span>
        </div>
      )}
      {settled && (
        <button
          type="button"
          // Hidden until hover, but still tabbable and revealed on focus — a
          // keyboard user has no hover to trigger it with.
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          onClick={() => {
            setCommittedValue(null)
            const node = localInputRef.current
            node?.focus()
            // Select rather than clear: replacing is the common case, and a
            // mis-click must not destroy the address.
            node?.select()
          }}
          disabled={disabled}
        >
          {t.shared.addressInput.change}
        </button>
      )}
    </div>
  )

  // Contacts-only lists (send) would otherwise go silently blank on a name
  // that matches nobody. Not for a bolt11/LNURL/npub or a full address.
  const showNoMatches =
    hideSuggestions &&
    !hideContacts &&
    !hasOptions &&
    !committed &&
    NAME_QUERY_RE.test(query) &&
    !NON_ADDRESS_PREFIX_RE.test(query) &&
    !isLightningAddress(query)

  if (variant === 'inline') {
    return (
      <>
        {fieldWithAffordances}
        {optionList ?? (
          <div className="min-h-0 flex-1">
            {showNoMatches && (
              <p className="px-0.5 text-sm text-muted-foreground">
                {t.shared.addressInput.noMatches}
              </p>
            )}
          </div>
        )}
      </>
    )
  }

  // Portalled on purpose: several of these live inside cards and dialogs with
  // `overflow-hidden`, which clips an absolutely-positioned list.
  return (
    <PopoverPrimitive.Root open={Boolean(optionList)}>
      {/* Anchor a full-width wrapper rather than the Input itself: Radix
      derives --radix-popover-trigger-width from the anchor, and measuring a
      wrapper that spans the field keeps the list exactly as wide as it. */}
      <PopoverPrimitive.Anchor asChild>
        <div className="w-full">{fieldWithAffordances}</div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          // The field keeps the focus — this is a combobox, not a dialog.
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
          // Typing must keep reaching the input behind the list.
          onPointerDownOutside={event => event.preventDefault()}
          className="z-50 w-(--radix-popover-trigger-width) outline-hidden"
        >
          {optionList}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export function LightningAddressOptionGroup({
  title,
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1" role="group" aria-label={title}>
      <p className="px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

export function LightningAddressOptionButton({
  id,
  name,
  label,
  icon,
  avatarUrl,
  active,
  buttonRef,
  onHighlight,
  onSelect,
  disabled
}: {
  id: string
  name: string
  /** The user's private alias, shown above the address when set. */
  label?: string | null
  /** Replaces the avatar, for options that aren't people (e.g. nodes). */
  icon?: ReactNode
  avatarUrl?: string | null
  active: boolean
  buttonRef: (node: HTMLButtonElement | null) => void
  onHighlight: () => void
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      // mousedown, not click: the input's blur would close the list first.
      onMouseDown={e => e.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onHighlight}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition-colors',
        'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70',
        active
          ? 'border-(--theme-300) bg-accent/80'
          : 'border-border/70 bg-card/80 hover:border-border hover:bg-card'
      )}
    >
      {icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted text-muted-foreground">
          {icon}
        </span>
      ) : (
        <Avatar className="size-7 border border-border/70">
          {avatarUrl && (
            <AvatarImage src={avatarUrl} alt="" className="object-cover" />
          )}
          <AvatarFallback className="text-[10px]">
            {initialsFor(name)}
          </AvatarFallback>
        </Avatar>
      )}
      {/* One line only: the address already contains the username, and the
      domain was repeating what the address ends with. An alias is the one
      thing the address can't say, so it gets a line of its own. */}
      {label ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {label}
          </span>
          <span className="truncate text-xs text-muted-foreground">{name}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {name}
        </span>
      )}
    </button>
  )
}

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`
}

function nextOptionIndex(
  current: number,
  optionCount: number,
  direction: 1 | -1
): number {
  if (optionCount <= 0) return -1
  if (direction === 1) {
    return current < 0 || current >= optionCount - 1 ? 0 : current + 1
  }
  return current <= 0 || current >= optionCount ? optionCount - 1 : current - 1
}

export function initialsFor(source: string): string {
  const parts = source
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1]
  return `${first}${second ?? ''}`.toUpperCase()
}

/**
 * A real avatar already on this device for an address: a saved contact on the
 * same address, or on another address with the same Nostr key (known once the
 * address was resolved), else the address's own cached lookup. No network —
 * the generated candidates are never looked up one by one.
 */
export function knownAvatarFor(
  address: string,
  contacts: Contact[]
): string | null {
  const cached = readAvatar(address)
  const pubkey = cached?.pubkey
  const contact = contacts.find(
    c =>
      c.avatarUrl &&
      (c.lightningAddress === address || (pubkey && c.pubkey === pubkey))
  )
  return contact?.avatarUrl ?? cached?.avatarUrl ?? null
}

function getAvatarFallbackForAddress(address: string): string | null {
  const domain = address.split('@')[1]
  return domain ? getDomainAvatarUrl(domain) : null
}

export type { LightningAddressSuggestion }
