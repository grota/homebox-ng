import { z } from 'zod'
import { FIELD_TYPES, itemTypeInput } from '@homebox/shared'
import { t, adminProcedure, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

// One custom field definition, provided inline on create. `config` is an
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

// `update` takes an optional subset of scalar fields. It deliberately has no
// `fields`: an edit that replaced the whole field set would delete the field
// rows and cascade every stored value away, so the field set is changed one row
// at a time through `updateFields` instead (see ADR-0003).
const updateInput = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
})
const idInput = z.object({ id: z.number().int().positive() })

// One row of the field-set diff sent to `updateFields`. `id` present = update
// that field row in place (the id survives, so no value cascade); `id` absent =
// insert a new field. An absent `required`/`config` PRESERVES the stored value.
const FieldUpsertInputSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1),
  fieldType: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().optional(),
})

// The whole explicit diff: upserts plus the ids to delete. `clearIncompatible`
// is the operator's consent to clear values a retype strands, and
// `acknowledgedValueCount` is the snapshot the server re-validates so a value
// added while the confirmation was open cannot be destroyed unseen.
const updateFieldsInput = z.object({
  id: z.number().int().positive(),
  upserts: z.array(FieldUpsertInputSchema).default([]),
  deletedIds: z.array(z.number().int().positive()).default([]),
  clearIncompatible: z.boolean().optional(),
  acknowledgeValueLoss: z.boolean().optional(),
  acknowledgedValueCount: z.number().int().nonnegative().optional(),
})

// `fieldType` narrows the read to the values a retype to that type would strand;
// without it the result is every non-empty value, which is what a deletion takes.
const fieldValueUsageInput = z.object({
  typeId: z.number().int().positive(),
  fieldId: z.number().int().positive(),
  fieldType: z.enum(FIELD_TYPES).optional(),
})

export const itemTypesRouter = t.router({
  // Item types are instance-wide (unlike locations). Reads (`list`) are
  // protected: any authenticated user may load the item-type select when
  // creating an item. Writes (`create`/`update`/`delete`) are admin-gated; a
  // non-admin gets `FORBIDDEN` on writes.
  list: protectedProcedure.query(({ ctx }) => service.listItemTypes(ctx.db)),
  create: adminProcedure.input(createInput).mutation(({ ctx, input }) => service.createItemType(ctx.db, input)),
  update: adminProcedure.input(updateInput).mutation(({ ctx, input }) => service.updateItemType(ctx.db, input)),
  // Only `fieldType` changes can strand a value, so only those are gated; see
  // `service.updateFields`. `fieldValueUsage` is admin-gated because only the
  // admin-only type editor calls it.
  updateFields: adminProcedure.input(updateFieldsInput).mutation(({ ctx, input }) => service.updateFields(ctx.db, input)),
  fieldValueUsage: adminProcedure.input(fieldValueUsageInput).query(({ ctx, input }) => service.fieldValueUsage(ctx.db, input)),
  delete: adminProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteItemType(ctx.db, input.id)),
})
