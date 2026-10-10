import { t, adminProcedure } from '../../trpc.js'
import * as service from './service.js'
import { startThumbnailJob } from './maintenance.js'

export const systemRouter = t.router({
  rebuildFts: adminProcedure.mutation(({ ctx }) => service.rebuild(ctx.db)),
  // Starts (or joins) the background thumbnail run; `thumbnailsStatus` is polled
  // for its progress and, once finished, its result.
  regenerateThumbnails: adminProcedure.mutation(({ ctx }) => startThumbnailJob(ctx.maintenance, ctx.db, ctx.dataDir)),
  thumbnailsStatus: adminProcedure.query(({ ctx }) => ctx.maintenance.thumbnails),
})
