import { t, adminProcedure } from '../../trpc.js'
import * as service from './service.js'

export const systemRouter = t.router({
  rebuildFts: adminProcedure.mutation(({ ctx }) => service.rebuild(ctx.db)),
})
