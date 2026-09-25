import { z } from 'zod'
import { ITEMS_PER_PAGE_MAX, ITEMS_PER_PAGE_MIN } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })
const idsInput = z.object({ ids: z.array(z.number().int().positive()).optional() })

// The same window the `itemsPerPage` preference can hold (see `items/router.ts`).
const pageSizeInput = z.number().int().min(ITEMS_PER_PAGE_MIN).max(ITEMS_PER_PAGE_MAX).optional()

export const trashRouter = t.router({
  list: protectedProcedure
    .input(z.object({ page: z.number().int().positive().optional(), pageSize: pageSizeInput }).optional())
    .query(({ ctx, input }) => service.listTrash(ctx.db, input?.page, input?.pageSize)),
  restore: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.restoreItem(ctx.db, input.id)),
  purge: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.purgeItem(ctx.db, input.id, ctx.dataDir)),
  purgeAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.purgeAll(ctx.db, input.ids, ctx.dataDir)),
})
