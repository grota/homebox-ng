import { z } from 'zod'
import { tagInput } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })

// `assign` re-establishes the links for one item: the given `tagIds` replace
// whatever the item previously had (no merging).
const assignInput = z.object({
  itemId: z.number().int().positive(),
  tagIds: z.array(z.number().int().positive()),
})

export const tagsRouter = t.router({
  // Tags are catalog-wide organizational metadata shared by every authenticated
  // user, so all four procedures use `protectedProcedure` (not `adminProcedure`).
  list: protectedProcedure.query(({ ctx }) => service.listTags(ctx.db)),
  create: protectedProcedure.input(tagInput).mutation(({ ctx, input }) => service.createTag(ctx.db, input)),
  assign: protectedProcedure.input(assignInput).mutation(({ ctx, input }) => service.assignTags(ctx.db, input)),
  delete: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteTag(ctx.db, input.id)),
})
