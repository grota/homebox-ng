import { z } from 'zod'
import { hexColor, tagInput } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

const idInput = z.object({ id: z.number().int().positive() })

// `update` targets one tag by id (unlike `create`, which upserts on the name).
// `color` reuses the same `hexColor` guard as `tagInput`; both fields are
// optional so a colour-only or name-only edit is expressible.
const updateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).optional(),
  color: z.string().regex(hexColor).optional(),
})

// `assign` re-establishes the links for one item: the given `tagIds` replace
// whatever the item previously had (no merging).
const assignInput = z.object({
  itemId: z.number().int().positive(),
  tagIds: z.array(z.number().int().positive()),
})

export const tagsRouter = t.router({
  // Tags are catalog-wide organizational metadata shared by every authenticated
  // user, so all five procedures use `protectedProcedure` (not `adminProcedure`).
  list: protectedProcedure.query(({ ctx }) => service.listTags(ctx.db)),
  create: protectedProcedure.input(tagInput).mutation(({ ctx, input }) => service.createTag(ctx.db, input)),
  update: protectedProcedure.input(updateInput).mutation(({ ctx, input }) => service.updateTag(ctx.db, input)),
  assign: protectedProcedure.input(assignInput).mutation(({ ctx, input }) => service.assignTags(ctx.db, input)),
  delete: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteTag(ctx.db, input.id)),
})
