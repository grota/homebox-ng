import { z } from 'zod'
import { locationInput } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

// `create` uses the shared `locationInput` ({ name, parentId }). `update` takes
// an optional subset of fields; when `parentId` is provided as `null` it moves
// the location up to the root. `delete` takes just a location id.
const idInput = z.object({ id: z.number().int().positive() })
const updateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  parentId: z.number().int().positive().nullable().optional(),
})

export const locationsRouter = t.router({
  // Locations are catalog-wide and shared across all authenticated users
  // (not admin-managed), so every procedure uses `protectedProcedure`.
  list: protectedProcedure.query(({ ctx }) => service.listLocations(ctx.db)),
  create: protectedProcedure.input(locationInput).mutation(({ ctx, input }) => service.createLocation(ctx.db, input)),
  update: protectedProcedure.input(updateInput).mutation(({ ctx, input }) => service.updateLocation(ctx.db, input)),
  // Deep delete of the location and its sub-locations. No `dataDir`: the items it
  // used to delete — and whose files it used to unlink — are now kept and
  // detached (ADR-0004).
  delete: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteLocation(ctx.db, input.id)),
  // What that delete would do, so the confirmation can name it before it
  // happens. The prompt says "7 items will have no location", and the location
  // DTO carries no item count to read it from.
  deletePreview: protectedProcedure.input(idInput).query(({ ctx, input }) => service.describeDelete(ctx.db, input.id)),
})
