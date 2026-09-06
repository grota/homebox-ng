import { instanceSettingsUpdateSchema } from '@homebox/shared'
import { t, adminProcedure } from '../../trpc.js'
import * as service from './service.js'

export const instanceSettingsRouter = t.router({
  get: adminProcedure.query(({ ctx }) => service.getSettings(ctx.db)),
  update: adminProcedure.input(instanceSettingsUpdateSchema).mutation(({ ctx, input }) =>
    service.updateSettings(ctx.db, input)
  ),
})
