import { z } from 'zod'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const setPrimaryInput = z.object({
  itemId: z.number().int().positive(),
  imageId: z.number().int().positive(),
})
const idInput = z.object({ id: z.number().int().positive() })

// Image rows belong to items, which are catalog-wide and available to any
// authenticated user, so every procedure uses `protectedProcedure`.
export const imagesRouter = t.router({
  listByItem: protectedProcedure
    .input(z.object({ itemId: z.number().int().positive() }))
    .query(({ ctx, input }) => service.listForItem(ctx.db, input.itemId)),
  setPrimary: protectedProcedure.input(setPrimaryInput).mutation(({ ctx, input }) => service.setPrimary(ctx.db, input.itemId, input.imageId)),
  delete: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteImage(ctx.db, input.id)),
})
