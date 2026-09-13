import { z } from 'zod'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })
const updateInput = z.object({ id: z.number().int().positive(), name: z.string().min(1) })
const idsInput = z.object({ ids: z.array(z.number().int().positive()).optional() })

export const draftsRouter = t.router({
  list: protectedProcedure
    .input(z.object({ page: z.number().int().positive().optional(), pageSize: z.number().int().positive().optional() }).optional())
    .query(({ ctx, input }) => service.listDrafts(ctx.db, input?.page, input?.pageSize)),
  update: protectedProcedure.input(updateInput).mutation(({ ctx, input }) => service.renameDraft(ctx.db, input.id, input.name)),
  publish: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.publishDraft(ctx.db, input.id)),
  publishAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.publishAll(ctx.db, input.ids)),
  // "Discard" used to mean "delete, irreversibly". It is recoverable now, so the
  // procedures take the recoverable word (ADR-0004, CONTEXT.md).
  trash: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.trashDraft(ctx.db, input.id)),
  trashAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.trashAll(ctx.db, input.ids)),
})
