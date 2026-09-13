import { z } from 'zod'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })
const idsInput = z.object({ ids: z.array(z.number().int().positive()).optional() })

export const trashRouter = t.router({
  list: protectedProcedure.query(({ ctx }) => service.listTrash(ctx.db)),
  restore: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.restoreItem(ctx.db, input.id)),
  purge: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.purgeItem(ctx.db, input.id, ctx.dataDir)),
  purgeAll: protectedProcedure.input(idsInput).mutation(({ ctx, input }) => service.purgeAll(ctx.db, input.ids, ctx.dataDir)),
})
