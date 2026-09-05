import { z } from 'zod'
import { itemInput } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'

// One custom-field value, provided inline on create. `value` is stored as-is in
// the `itemCustomFieldValues.value` text column.
const fieldValueInput = z.object({
  fieldId: z.number().int().positive(),
  value: z.string(),
})

// `create` extends the shared `itemInput` ({ name, description, quantity, unit,
// itemTypeId, locationId }) with an optional `fieldValues` set (defaults to []).
// `quantity` is already validated `>= 0` by the shared schema.
const createItemInput = itemInput.extend({ fieldValues: z.array(fieldValueInput).default([]) })

// `update` takes an optional subset of the scalar fields plus an optional
// `fieldValues` set (when provided, it replaces the item's whole value set).
const updateItemInput = z.object({
  id: z.number().int().positive(),
  ...itemInput.partial().shape,
  fieldValues: z.array(fieldValueInput).optional(),
})
const idInput = z.object({ id: z.number().int().positive() })
const listInput = z.object({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  search: z.string().optional(),
  locationId: z.number().int().positive().optional(),
  itemTypeId: z.number().int().positive().optional(),
})

export const itemsRouter = t.router({
  // Items are catalog-wide and shared across all authenticated users (each is
  // stamped with its creator), so every procedure uses `protectedProcedure`.
  create: protectedProcedure.input(createItemInput).mutation(({ ctx, input }) => service.createItem(ctx.db, input, ctx.user!.id)),
  update: protectedProcedure.input(updateItemInput).mutation(({ ctx, input }) => service.updateItem(ctx.db, input)),
  delete: protectedProcedure.input(idInput).mutation(({ ctx, input }) => service.deleteItem(ctx.db, input.id)),
  get: protectedProcedure.input(idInput).query(({ ctx, input }) => service.getItem(ctx.db, input.id)),
  list: protectedProcedure.input(listInput).query(({ ctx, input }) => service.listItems(ctx.db, input)),
})
