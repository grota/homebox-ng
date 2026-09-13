import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import * as repo from './repo.js'
import type { CustomFieldValueRow, FacetCount, ImageRow, ItemRow, LocationRefRow, SearchFacets, TagFacet, TagRow, TypeRefRow } from './repo.js'
import { reindexItem } from './fts.js'

// Facet shapes are defined once in `repo.ts` (surfaced by `repo.searchItems`);
// re-export here so callers have a single import site for the DTO facets.
export type { FacetCount, SearchFacets, TagFacet }

// ---------------------------------------------------------------------------
// DTO shapes (see task-9 brief HYDRATION bullet).
// ---------------------------------------------------------------------------
export type CustomFieldDto = { fieldId: number; fieldName: string; fieldType: CustomFieldValueRow['fieldType']; value: string | null }
export type TypeRefDto = { id: number; name: string }
export type LocationRefDto = { id: number; name: string }
export type TagDto = { id: number; name: string; color: string | null }
export type ImageDto = { id: number; originalPath: string; editedPath: string | null; thumbPath: string; isPrimary: boolean | null }

export type ItemDto = {
  id: number
  name: string
  description: string
  quantity: number
  unit: string | null
  published: boolean
  trashedAt: Date | null
  itemTypeId: number
  locationId: number | null
  createdBy: number
  createdAt: Date | null
  updatedAt: Date | null
  customFields: CustomFieldDto[]
  type: TypeRefDto | null
  location: LocationRefDto | null
  tags: TagDto[]
  images: ImageDto[]
  snippet?: string
}

export type CreateItemInput = {
  name: string
  description: string
  quantity: number
  unit: string | null
  itemTypeId: number
  locationId: number | null
  fieldValues: { fieldId: number; value: string }[]
}
export type UpdateItemInput = Partial<Omit<CreateItemInput, 'fieldValues'>> & { id: number; fieldValues?: { fieldId: number; value: string }[] }
export type ListItemsInput = { page?: number; pageSize?: number; search?: string; locationId?: number; itemTypeId?: number; tagIds?: number[] }

const toDto = (
  row: ItemRow,
  customFields: CustomFieldValueRow[],
  type: TypeRefRow | undefined,
  location: LocationRefRow | undefined,
  tags: TagRow[],
  images: ImageRow[]
): ItemDto => ({
  id: row.id,
  name: row.name,
  description: row.description,
  quantity: row.quantity,
  unit: row.unit,
  published: row.published,
  trashedAt: row.trashedAt,
  itemTypeId: row.itemTypeId,
  locationId: row.locationId,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  customFields: customFields.map((cf) => ({ fieldId: cf.fieldId, fieldName: cf.fieldName, fieldType: cf.fieldType, value: cf.value })),
  type: type ? { id: type.id, name: type.name } : null,
  location: location ? { id: location.id, name: location.name } : null,
  tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  images: images.map((img) => ({ id: img.id, originalPath: img.originalPath, editedPath: img.editedPath, thumbPath: img.thumbPath, isPrimary: img.isPrimary })),
})

// Group child-table rows by `itemId` so a list of items can be hydrated in one pass.
const groupByItemId = <T extends { itemId: number }>(rows: T[]): Map<number, T[]> => {
  const map = new Map<number, T[]>()
  for (const row of rows) {
    const arr = map.get(row.itemId) ?? []
    arr.push(row)
    map.set(row.itemId, arr)
  }
  return map
}

const distinct = (values: number[]): number[] => [...new Set(values)]

// Hydrate a batch of item rows with one query per child table (avoids N+1), then
// group each table's rows back onto its item. Returns `ItemDto[]` WITHOUT the
// live `snippet` (that is attached by the caller, e.g. `listItems`, by index).
export const hydrateRows = (db: DrizzleDb, rows: ItemRow[]): ItemDto[] => {
  const fieldsByItem = groupByItemId(repo.listCustomFields(db, rows.map((r) => r.id)))
  const tagsByItem = groupByItemId(repo.listTags(db, rows.map((r) => r.id)))
  const imagesByItem = groupByItemId(repo.listImages(db, rows.map((r) => r.id)))
  const typeIds = distinct(rows.map((r) => r.itemTypeId))
  const typeById = new Map(repo.listTypeRefsById(db, typeIds).map((t) => [t.id, t]))
  const locationIds = distinct(rows.filter((r) => r.locationId != null).map((r) => r.locationId!))
  const locationById = new Map(repo.listLocationRefsById(db, locationIds).map((l) => [l.id, l]))
  return rows.map((row) =>
    toDto(row, fieldsByItem.get(row.id) ?? [], typeById.get(row.itemTypeId), row.locationId != null ? locationById.get(row.locationId) : undefined, tagsByItem.get(row.id) ?? [], imagesByItem.get(row.id) ?? [])
  )
}

// Hydrate a single item row (a one-item batch; same child-table queries as a list).
const hydrateOne = (db: DrizzleDb, row: ItemRow): ItemDto => hydrateRows(db, [row])[0]

// The detail query behind `items.get`. A trashed item is not reachable: `/items/:id`
// must 404 rather than render something the catalog hides. `repo.getItem` stays
// unfiltered because the trash's own restore/purge paths need the raw row.
export const getItem = (db: DrizzleDb, id: number): ItemDto => {
  const row = repo.getItem(db, id)
  if (!row || row.trashedAt != null) throw new TRPCError({ code: 'NOT_FOUND' })
  return hydrateOne(db, row)
}

export const createItem = (db: DrizzleDb, input: CreateItemInput, createdBy: number): ItemDto => {
  const row = repo.createItem(db, {
    name: input.name,
    description: input.description,
    quantity: input.quantity,
    unit: input.unit,
    itemTypeId: input.itemTypeId,
    locationId: input.locationId,
    createdBy,
    published: true,
    fieldValues: input.fieldValues.map((fv) => ({ fieldId: fv.fieldId, value: fv.value })),
  })
  return hydrateOne(db, row)
}

export const updateItem = (db: DrizzleDb, input: UpdateItemInput): ItemDto => {
  const existing = repo.getItem(db, input.id)
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })

  const data: repo.UpdateItemData = {}
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description
  if (input.quantity !== undefined) data.quantity = input.quantity
  if (input.unit !== undefined) data.unit = input.unit
  if (input.itemTypeId !== undefined) data.itemTypeId = input.itemTypeId
  if (input.locationId !== undefined) data.locationId = input.locationId

  // The item write and its FTS reindex commit atomically: rename + field-value
  // replacement + reindex all happen in one transaction (or none of them).
  const row = db.transaction((tx) => {
    const t = tx as unknown as DrizzleDb
    const updated = Object.keys(data).length > 0 ? repo.updateItem(t, input.id, data) ?? existing : existing
    if (input.fieldValues !== undefined) {
      repo.replaceFieldValues(t, input.id, input.fieldValues.map((fv) => ({ fieldId: fv.fieldId, value: fv.value })))
    }
    reindexItem(t, input.id)
    return updated
  })

  return hydrateOne(db, row)
}

export const deleteItem = (db: DrizzleDb, id: number): { ok: true } => {
  if (!repo.getItem(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  if (!repo.deleteItem(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  reindexItem(db, id) // computeBlob returns null for the gone item → clears the items_fts row
  return { ok: true }
}

// Paginated list, hydrated with `customFields`, `type`, `location`, `tags`,
// `images`, and a live `snippet` + facet counts. Takes the same input shape as
// `repo.searchItems`, which handles BOTH the FTS search and the no-search case
// and returns `{ rows, total, facets }`. Child tables are fetched in batches
// (one query per table) to avoid N+1, then grouped back onto each item. The
// `snippet` is attached only when present (i.e. only when `input.search` is
// set, since the no-search / LIKE-fallback paths return `snippet: null`).
export const listItems = (db: DrizzleDb, input: ListItemsInput): { items: ItemDto[]; total: number; facets: SearchFacets } => {
  const { rows, total, facets } = repo.searchItems(db, input)
  if (rows.length === 0) return { items: [], total, facets }

  const items = hydrateRows(db, rows)
  // hydrateRows returns items without the live `snippet`; attach it back by index.
  rows.forEach((row, i) => {
    if (row.snippet != null) items[i].snippet = row.snippet
  })
  return { items, total, facets }
}
