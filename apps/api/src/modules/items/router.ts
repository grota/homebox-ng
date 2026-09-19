import { z } from 'zod'
import { itemInput, ITEM_SORTS } from '@homebox/shared'
import { t, protectedProcedure } from '../../trpc.js'
import * as service from './service.js'
import * as trashService from '../trash/service.js'

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
  // A location id selects that location's **whole subtree** (ADR-0009), and
  // `'none'` selects the items with no location at all.
  locationId: z.union([z.literal('none'), z.number().int().positive()]).optional(),
  itemTypeId: z.number().int().positive().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  // Omitted means the default ordering (`createdAt:desc`) — and, while a search
  // term is present, relevance, which is what this call has always done.
  sort: z.enum(ITEM_SORTS).optional(),
  // "Show me just these" — the selection has no other route onto the page, because
  // it outlives the view that made it.
  ids: z.array(z.number().int().positive()).optional(),
})

// A **criteria clause**: what adds items to, or removes them from, a selection.
// Every field is optional, they are AND-ed, and the values are drawn only from
// data that exists. Several locations, where the sidebar takes one — a clause is a
// query, not a filter.
const dayInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const selectionClauseInput = z.object({
  search: z.string().optional(),
  itemTypeId: z.number().int().positive().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  locationIds: z.array(z.union([z.literal('none'), z.number().int().positive()])).optional(),
  createdFrom: dayInput.optional(),
  createdTo: dayInput.optional(),
})

export const itemsRouter = t.router({
  // Items are catalog-wide and shared across all authenticated users (each is
  // stamped with its creator), so every procedure uses `protectedProcedure`.
  create: protectedProcedure.input(createItemInput).mutation(({ ctx, input }) => service.createItem(ctx.db, input, ctx.user!.id)),
  update: protectedProcedure.input(updateItemInput).mutation(({ ctx, input }) => service.updateItem(ctx.db, input)),
  // Recoverable since ADR-0004: this moves the item to the trash. Destroying it
  // is `trash.purge`, which is a different procedure with a different name.
  trash: protectedProcedure.input(idInput).mutation(({ ctx, input }) => trashService.trashItem(ctx.db, input.id)),
  get: protectedProcedure.input(idInput).query(({ ctx, input }) => service.getItem(ctx.db, input.id)),
  list: protectedProcedure.input(listInput).query(({ ctx, input }) => service.listItems(ctx.db, input)),
  // Backs all three selection gestures: "select all N matching", and both criteria
  // modes. One read, so they cannot resolve differently.
  resolveSelection: protectedProcedure.input(selectionClauseInput).query(({ ctx, input }) => service.resolveSelection(ctx.db, input)),
  // The catalog's real creation-date span, so the date clause can be bounded by it.
  createdAtRange: protectedProcedure.query(({ ctx }) => service.createdAtRange(ctx.db)),
})
