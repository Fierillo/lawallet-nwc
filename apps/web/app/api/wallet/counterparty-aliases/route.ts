import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { updateCounterpartyAliasSchema } from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandling(async (request: Request) => {
  const userId = await requireUserId(request)
  const rows = await prisma.counterpartyAlias.findMany({
    where: { userId },
    select: { key: true, alias: true }
  })
  const aliases: Record<string, string> = {}
  for (const row of rows) aliases[row.key] = row.alias
  return NextResponse.json(
    { aliases },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})

export const PUT = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  const userId = await requireUserId(request)
  const { key, alias } = await validateBody(
    request,
    updateCounterpartyAliasSchema
  )

  if (alias) {
    await prisma.counterpartyAlias.upsert({
      where: { userId_key: { userId, key } },
      create: { userId, key, alias },
      update: { alias }
    })
  } else {
    await prisma.counterpartyAlias.deleteMany({ where: { userId, key } })
  }

  return NextResponse.json(
    { key, alias: alias || null },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
