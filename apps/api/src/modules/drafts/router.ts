import { z } from 'zod'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })
const updateInput = z.object({ id: z.number().int().positive(), name: z.string().min(1) })
const idsInput = z.object({ ids: z.array(z.number().int().positive()).optional() })

export const draftsRouter = t.router({
  list: protectedProcedure.query(({ ctx }) => service.listDrafts(ctx.db)),
  update: protectedProcedure.input(updateInput).mutation(({ ctx, input }) => service.renameDraft(ctx.db, input.id, input.name)),
  publish: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.publishDraft(ctx.db, input.id)),
  publishAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.publishAll(ctx.db, input.ids)),
  discard: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.discardDraft(ctx.db, input.id, ctx.dataDir)),
  discardAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.discardAll(ctx.db, input.ids, ctx.dataDir)),
})
