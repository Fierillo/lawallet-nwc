import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import {
  importRecipientsSchema,
  saveRecipientSchema
} from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'

const MAX_RECIPIENTS = 50
const headers = { 'Cache-Control': 'private, no-store' }

export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId(request)
  const recipients = await prisma.savedRecipient.findMany({
    where: { userId },
    orderBy: { lastUsedAt: 'desc' },
    take: MAX_RECIPIENTS,
    select: {
      lightningAddress: true,
      name: true,
      avatarUrl: true,
      lastUsedAt: true
    }
  })
  return NextResponse.json({ recipients }, { headers })
})

export const PUT = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const userId = await requireUserId(request)
  const { lightningAddress, name, avatarUrl } = await validateBody(
    request,
    saveRecipientSchema
  )

  const data = {
    ...(name ? { name } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    lastUsedAt: new Date()
  }
  await prisma.savedRecipient.upsert({
    where: { userId_lightningAddress: { userId, lightningAddress } },
    create: { userId, lightningAddress, ...data },
    update: data
  })

  return NextResponse.json({ lightningAddress }, { headers })
})

/**
 * Backfill from a device's payment history. Only inserts addresses the
 * account doesn't have yet, so a newer pick on another device is never
 * overwritten by an older history entry.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const userId = await requireUserId(request)
  const { recipients } = await validateBody(request, importRecipientsSchema)
  const now = Date.now()

  const { count } = await prisma.savedRecipient.createMany({
    data: recipients.map(recipient => ({
      userId,
      lightningAddress: recipient.lightningAddress,
      name: recipient.name || null,
      avatarUrl: recipient.avatarUrl || null,
      lastUsedAt: new Date(Math.min(Date.parse(recipient.lastUsedAt), now))
    })),
    skipDuplicates: true
  })

  return NextResponse.json({ inserted: count }, { headers })
})
