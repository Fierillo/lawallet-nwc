import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  transactionLabelParam,
  updateTransactionNoteSchema
} from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ paymentHash: string }> }

export const GET = withErrorHandling(
  async (request: Request, context: Context) => {
    const userId = await requireUserId(request)
    const { paymentHash } = validateParams(
      await context.params,
      transactionLabelParam
    )
    const annotation = await prisma.transactionNote.findUnique({
      where: { userId_paymentHash: { userId, paymentHash } },
      select: { note: true }
    })

    return NextResponse.json(
      { note: annotation?.note ?? null },
      {
        headers: { 'Cache-Control': 'private, no-store' }
      }
    )
  }
)

export const PUT = withErrorHandling(
  async (request: Request, context: Context) => {
    await checkRequestLimits(request, 'json')
    const userId = await requireUserId(request)
    const { paymentHash } = validateParams(
      await context.params,
      transactionLabelParam
    )
    const { note } = await validateBody(request, updateTransactionNoteSchema)

    if (note) {
      await prisma.transactionNote.upsert({
        where: { userId_paymentHash: { userId, paymentHash } },
        create: { userId, paymentHash, note },
        update: { note }
      })
    } else {
      await prisma.transactionNote.deleteMany({
        where: { userId, paymentHash }
      })
    }

    return NextResponse.json(
      { note: note || null },
      {
        headers: { 'Cache-Control': 'private, no-store' }
      }
    )
  }
)
