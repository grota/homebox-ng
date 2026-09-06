import { userSettingsUpdateSchema } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

export const settingsRouter = t.router({
  // Returns the current user's settings (spec defaults when no row exists yet).
  get: protectedProcedure.query(({ ctx }) => service.getSettings(ctx.db, ctx.user!.id)),
  // Validates a partial of the settings shape and upserts; returns the full DTO.
  update: protectedProcedure.input(userSettingsUpdateSchema).mutation(({ ctx, input }) =>
    service.updateSettings(ctx.db, ctx.user!.id, input)
  ),
})
