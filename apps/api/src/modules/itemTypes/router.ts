import { z } from 'zod'
import { FIELD_TYPES, itemTypeInput } from '@homebox/shared'
import { t, adminProcedure, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

// One custom field definition, provided inline on create/update. `config` is an
// arbitrary JSON object (stored as-is in the JSON column); `sortOrder` controls
// display order within the type.
export const ItemTypeFieldInputSchema = z.object({
  name: z.string().min(1),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
})
export type ItemTypeFieldInput = z.infer<typeof ItemTypeFieldInputSchema>

// `create` extends the shared `itemTypeInput` ({ name, description? }) with the
// type's field definitions, defaulting to an empty set.
const createInput = itemTypeInput.extend({ fields: z.array(ItemTypeFieldInputSchema).default([]) })

// `update` takes an optional subset of scalar fields; when `fields` is provided
// it replaces the type's whole field set.
const updateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  fields: z.array(ItemTypeFieldInputSchema).optional(),
})
const idInput = z.object({ id: z.number().int().positive() })

export const itemTypesRouter = t.router({
  // Item types are instance-wide (unlike locations). Reads (`list`) are
  // protected: any authenticated user may load the item-type select when
  // creating an item. Writes (`create`/`update`/`delete`) are admin-gated; a
  // non-admin gets `FORBIDDEN` on writes.
  list: protectedProcedure.query(({ ctx }) => service.listItemTypes(ctx.db)),
  create: adminProcedure.input(createInput).mutation(({ ctx, input }) => service.createItemType(ctx.db, input)),
  update: adminProcedure.input(updateInput).mutation(({ ctx, input }) => service.updateItemType(ctx.db, input)),
  delete: adminProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteItemType(ctx.db, input.id)),
})
