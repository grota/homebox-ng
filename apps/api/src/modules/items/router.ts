import { z } from 'zod'
import { itemInput, ITEM_SORTS, ITEMS_PER_PAGE_MAX, ITEMS_PER_PAGE_MIN } from '@homebox/shared'
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
  // Bounded to the same window the `itemsPerPage` preference can hold: the two
  // ends of the wire have to agree on what a legal page size is, and without the
  // ceiling a hand-made request could ask for the whole catalog at once.
  pageSize: z.number().int().min(ITEMS_PER_PAGE_MIN).max(ITEMS_PER_PAGE_MAX).optional(),
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

// The edit being composed in the modal. Shared by the summary (which reports what
// it would change) and the write (which pins those same numbers).
const bulkEditChangeInput = z.object({
  location: z.object({ set: z.number().int().positive().nullable() }).optional(),
  tags: z
    .object({
      add: z.array(z.number().int().positive()).optional(),
      remove: z.array(z.number().int().positive()).optional(),
    })
    .optional(),
  fieldValues: z
    .array(z.object({ fieldId: z.number().int().positive(), value: z.string().nullable() }))
    .optional(),
})

export const itemsRouter = t.router({
  // Items are catalog-wide and shared across all authenticated users (each is
  // stamped with its creator), so every procedure uses `protectedProcedure`.
  create: protectedProcedure.input(createItemInput).mutation(({ ctx, input }) => service.createItem(ctx.db, input, ctx.user!.id)),
  update: protectedProcedure.input(updateItemInput).mutation(({ ctx, input }) => service.updateItem(ctx.db, input)),
  // Recoverable since ADR-0004: this moves the item to the trash. Destroying it
  // is `trash.purge`, which is a different procedure with a different name.
  trash: protectedProcedure.input(idInput).mutation(({ ctx, input }) => trashService.trashItem(ctx.db, input.id)),
  // The same move for a whole selection, in one request rather than one per id.
  // `.min(1)` for `bulkUpdate`'s reason: an empty selection is a caller error, not
  // "everything".
  trashMany: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1) }))
    .mutation(({ ctx, input }) => trashService.trashItems(ctx.db, input.ids)),
  get: protectedProcedure.input(idInput).query(({ ctx, input }) => service.getItem(ctx.db, input.id)),
  list: protectedProcedure.input(listInput).query(({ ctx, input }) => service.listItems(ctx.db, input)),
  // Backs all three selection gestures: "select all N matching", and both criteria
  // modes. One read, so they cannot resolve differently.
  resolveSelection: protectedProcedure.input(selectionClauseInput).query(({ ctx, input }) => service.resolveSelection(ctx.db, input)),
  // The catalog's real creation-date span, so the date clause can be bounded by it.
  createdAtRange: protectedProcedure.query(({ ctx }) => service.createdAtRange(ctx.db)),
  // What the selection holds, and what a pending edit would change. The modal
  // shows the numbers this returns rather than deriving its own, so the count on
  // the button and the count the write pins are the same code.
  selectionSummary: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()), pending: bulkEditChangeInput.optional() }))
    .query(({ ctx, input }) => service.selectionSummary(ctx.db, input.ids, input.pending)),
  bulkUpdate: protectedProcedure
    .input(
      bulkEditChangeInput.extend({
        // `.min(1)`: an empty selection is refused outright, never read as
        // "everything" — a checkbox UI can produce one, and this is not the drafts
        // verbs, where empty means all of them.
        ids: z.array(z.number().int().positive()).min(1),
        acknowledgedItemCount: z.number().int().min(0),
        acknowledgedOverwriteCounts: z.record(z.number().int().min(0)).optional(),
      }),
    )
    .mutation(({ ctx, input }) => service.bulkUpdate(ctx.db, input)),
})
