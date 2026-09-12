import { and, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { items, itemCustomFieldValues, itemTypeFields, itemTypes, locations, itemTags, tags, images } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { reindexItem } from './fts.js'

// Row shape surfaced by the app layer. CamelCase object keys (the schema is
// already camelCase on the JS surface). Timestamps land as JS `Date` (the
// columns are `timestamp_ms` mode); `unit`/`locationId` are nullable.
export type ItemRow = {
  id: number
  name: string
  description: string
  quantity: number
  unit: string | null
  itemTypeId: number
  locationId: number | null
  createdBy: number
  published: boolean
  createdAt: Date | null
  updatedAt: Date | null
}

export type CustomFieldValueRow = {
  itemId: number
  fieldId: number
  fieldName: string
  fieldType: 'text' | 'number' | 'currency' | 'date' | 'boolean' | 'url'
  value: string | null
}

export type TypeRefRow = { id: number; name: string }
export type LocationRefRow = { id: number; name: string }

export type TagRow = { itemId: number; id: number; name: string; color: string | null }
export type ImageRow = { itemId: number; id: number; originalPath: string; editedPath: string | null; thumbPath: string; isPrimary: boolean | null }

// Select only the DTO columns.
const ITEM_FIELDS = {
  id: items.id,
  name: items.name,
  description: items.description,
  quantity: items.quantity,
  unit: items.unit,
  itemTypeId: items.itemTypeId,
  locationId: items.locationId,
  createdBy: items.createdBy,
  published: items.published,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
} as const

export const getItem = (db: DrizzleDb, id: number): ItemRow | undefined =>
  db.select(ITEM_FIELDS).from(items).where(eq(items.id, id)).get()

// ---------------------------------------------------------------------------
// Ranked FTS search + live facets. `searchItems` handles BOTH the search and the
// no-search case (it is the path Task 5 routes through). When a `search` term is
// present it runs a ranked FTS5 `MATCH` (with `snippet`), otherwise it falls back
// to the plain `items` filter. Facet counts are computed live: for each dimension
// the query OMITS that dimension's own filter but KEEPS the search predicate and
// the other dimensions' filters (so selecting a type still shows every matching
// type in the type facet, etc.).
//
// Every relational `where` fragment references `items.<column>` explicitly, so
// the same fragment is valid whether the query is `FROM items` or
// `FROM items_fts JOIN items ON items.id = items_fts.item_id`. The search
// predicate is passed in as a fragment (an FTS `MATCH` or a `LIKE` for the
// malformed-term fallback), and the FTS `JOIN` is added only when needed.
// ---------------------------------------------------------------------------

export type FacetCount = { id: number; name: string; count: number }
export type TagFacet = { id: number; name: string; color: string | null; count: number }
export type SearchFacets = { types: FacetCount[]; tags: TagFacet[]; locations: FacetCount[] }
export type SearchRow = ItemRow & { snippet: string | null }
export type SearchItemsOptions = {
  page?: number
  pageSize?: number
  search?: string
  locationId?: number
  itemTypeId?: number
  tagIds?: number[]
}

type RelationalFilters = { locationId?: number; itemTypeId?: number; tagIds?: number[] }

// `LocationRow`-like level node (id + name only) used by the location facet.
type LevelNode = { id: number; name: string }

// `buildWhere` composes the relational filters (and an optional search predicate)
// into a single AND'd fragment. A `published = true` base predicate is always
// present, so drafts (`published = false`) never leak into the catalog, search,
// or any facet count. The `tagIds` predicate is OR-within-dimension: an item
// matches if it carries AT LEAST ONE of the selected tags (membership in the
// subselect of `item_tags` ids).
const buildWhere = (db: DrizzleDb, filters: RelationalFilters, searchPredicate?: SQL): SQL | undefined => {
  const conds: SQL[] = [eq(items.published, true)] // drafts never leak into the catalog or facets
  if (searchPredicate) conds.push(searchPredicate)
  if (filters.locationId != null) conds.push(eq(items.locationId, filters.locationId))
  if (filters.itemTypeId != null) conds.push(eq(items.itemTypeId, filters.itemTypeId))
  if (filters.tagIds?.length) {
    conds.push(inArray(items.id, db.select({ id: itemTags.itemId }).from(itemTags).where(inArray(itemTags.tagId, filters.tagIds))))
  }
  return conds.length ? and(...conds) : undefined
}

// A search context carries the predicate (used in `WHERE`) and the FTS join
// (used in `FROM`). The FTS path drags in `items_fts`; the LIKE fallback and the
// no-search case do not. Keeping the join on the context means `computeFacets`
// reuses the same composition for all three.
type SearchCtx = { predicate?: SQL; join: SQL }

const ftsCtx = (term: string): SearchCtx => ({
  predicate: sql`items_fts MATCH ${term}`,
  join: sql`JOIN items_fts ON items.id = items_fts.item_id`,
})

// Literal substring match on `name`. `%`/`_`/`\` are escaped so the search term
// is matched literally (never as wildcards).
const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`)

const likeCtx = (term: string): SearchCtx => ({
  predicate: sql`${items.name} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`,
  join: sql``,
})

const plainCtx: SearchCtx = { predicate: undefined, join: sql`` }

const isSqliteError = (e: unknown): boolean => e instanceof Error && (e as { code?: unknown }).code === 'SQLITE_ERROR'

// The current-level nodes for the location facet: children of the selected
// location, or root locations when no location is selected.
const getLevelNodes = (db: DrizzleDb, locationId?: number): LevelNode[] => {
  if (locationId != null) {
    return db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.parentId, locationId)).all()
  }
  return db.select({ id: locations.id, name: locations.name }).from(locations).where(isNull(locations.parentId)).all()
}

const computeLocationFacet = (db: DrizzleDb, filters: RelationalFilters, ctx: SearchCtx): FacetCount[] => {
  // Omit `locationId` from the count's WHERE (keep search + type + tags).
  const whereNoLocation = buildWhere(db, { itemTypeId: filters.itemTypeId, tagIds: filters.tagIds }, ctx.predicate)
  return getLevelNodes(db, filters.locationId)
    .map((node): FacetCount => {
      // Subtree count: node + all descendants, via a cycle-safe recursive CTE.
      // `UNION` (distinct) — not `UNION ALL` — so a cyclic `parent_id` chain
      // terminates (the data model permits cycles).
      const whereFrags: SQL[] = [sql`items.location_id IN (SELECT id FROM sub)`]
      if (whereNoLocation) whereFrags.push(whereNoLocation)
      const count = db.get<{ count: number }>(sql`
        WITH RECURSIVE sub(id) AS (
          SELECT ${node.id}
          UNION
          SELECT l.id FROM locations l JOIN sub ON l.parent_id = sub.id
        )
        SELECT COUNT(*) AS count FROM items
        ${ctx.join}
        WHERE ${and(...whereFrags)}
      `)?.count ?? 0
      return { id: node.id, name: node.name, count }
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

const computeFacets = (db: DrizzleDb, filters: RelationalFilters, ctx: SearchCtx): SearchFacets => {
  // Types facet omits `itemTypeId`; keeps search + locationId + tagIds.
  const whereNoType = buildWhere(db, { locationId: filters.locationId, tagIds: filters.tagIds }, ctx.predicate)
  const types = db.all<FacetCount>(sql`
    SELECT items.item_type_id AS id, item_types.name AS name, COUNT(*) AS count
    FROM items
    JOIN item_types ON item_types.id = items.item_type_id
    ${ctx.join}
    ${whereNoType ? sql`WHERE ${whereNoType}` : sql``}
    GROUP BY items.item_type_id
    ORDER BY count DESC, item_types.name ASC
  `)

  // Tags facet omits `tagIds`; keeps search + locationId + itemTypeId.
  const whereNoTags = buildWhere(db, { locationId: filters.locationId, itemTypeId: filters.itemTypeId }, ctx.predicate)
  const tags = db.all<TagFacet>(sql`
    SELECT tags.id AS id, tags.name AS name, tags.color AS color, COUNT(DISTINCT items.id) AS count
    FROM item_tags
    JOIN items ON items.id = item_tags.item_id
    JOIN tags ON tags.id = item_tags.tag_id
    ${ctx.join}
    ${whereNoTags ? sql`WHERE ${whereNoTags}` : sql``}
    GROUP BY tags.id
    ORDER BY count DESC, tags.name ASC
  `)

  const locations = computeLocationFacet(db, filters, ctx)

  return { types, tags, locations }
}

// Load the full `ITEM_FIELDS` for the rank-ordered ids, preserving the rank order
// (the second query's natural order is NOT relied upon), then merge `snippet`.
const hydrateRows = (db: DrizzleDb, idRows: { id: number; snippet: string | null }[]): SearchRow[] => {
  if (idRows.length === 0) return []
  const ids = idRows.map((r) => r.id)
  const hydrated = db.select(ITEM_FIELDS).from(items).where(inArray(items.id, ids)).all()
  const byId = new Map(hydrated.map((r) => [r.id, r]))
  const snippetById = new Map(idRows.map((r) => [r.id, r.snippet]))
  return ids.map((id) => {
    const row = byId.get(id)
    if (!row) throw new Error(`searchItems: item ${id} was not hydrated`)
    return { ...row, snippet: snippetById.get(id) ?? null }
  })
}

const runFtsSearch = (db: DrizzleDb, opts: SearchItemsOptions, term: string, pageSize: number, offset: number) => {
  const ctx = ftsCtx(term)
  const where = buildWhere(db, { locationId: opts.locationId, itemTypeId: opts.itemTypeId, tagIds: opts.tagIds }, ctx.predicate)

  // Step 1: ids in rank order (with a snippet). `rank` is FTS5's bm25 — lower is
  // better. `snippet(..., -1, ...)` snips across ALL indexed columns (index `-1`),
  // not just `name`, so a match in a tag/type/location still shows context.
  const idRows = db.all<{ id: number; snippet: string | null }>(sql`
    SELECT items.id, snippet(items_fts, -1, '', '', ' … ', 16) AS snippet
    FROM items_fts JOIN items ON items.id = items_fts.item_id
    ${where ? sql`WHERE ${where}` : sql``}
    ORDER BY rank ASC, items.created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `)

  // Total over the same predicate, before LIMIT/OFFSET.
  const total = db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c
    FROM items_fts JOIN items ON items.id = items_fts.item_id
    ${where ? sql`WHERE ${where}` : sql``}
  `)?.c ?? 0

  const facets = computeFacets(db, { locationId: opts.locationId, itemTypeId: opts.itemTypeId, tagIds: opts.tagIds }, ctx)
  return { rows: hydrateRows(db, idRows), total, facets }
}

// The two non-ranked paths (no term, and the LIKE fallback for a MATCH FTS5
// rejects) differ only in their search context, so they share one body.
const runPlainSearch = (db: DrizzleDb, opts: SearchItemsOptions, ctx: SearchCtx, pageSize: number, offset: number) => {
  const filters = { locationId: opts.locationId, itemTypeId: opts.itemTypeId, tagIds: opts.tagIds }
  const where = buildWhere(db, filters, ctx.predicate)
  const total = db.select({ c: count() }).from(items).where(where).get()?.c ?? 0
  const rows = db.select(ITEM_FIELDS).from(items).where(where).orderBy(desc(items.createdAt)).limit(pageSize).offset(offset).all()
  return { rows: rows.map((r) => ({ ...r, snippet: null })), total, facets: computeFacets(db, filters, ctx) }
}

// Ranked FTS search (or plain filter when no term) with live facet counts and a
// per-row `snippet`. Returns `{ rows, total, facets }`.
export const searchItems = (db: DrizzleDb, opts: SearchItemsOptions): { rows: SearchRow[]; total: number; facets: SearchFacets } => {
  const term = opts.search?.trim()
  const page = opts.page ?? 1
  const pageSize = opts.pageSize ?? 20
  const offset = (page - 1) * pageSize

  if (term) {
    try {
      return runFtsSearch(db, opts, term, pageSize, offset)
    } catch (e) {
      // FTS5 throws a `SQLITE_ERROR` on a syntactically invalid `MATCH` (e.g. an
      // unbalanced quote). The list must never throw on user search input, so we
      // fall back to a literal name `LIKE` with the same relational filters and
      // the same facet composition. A non-FTS error is rethrown.
      if (isSqliteError(e)) {
        return runPlainSearch(db, opts, likeCtx(term), pageSize, offset)
      }
      throw e
    }
  }

  return runPlainSearch(db, opts, plainCtx, pageSize, offset)
}

export type CreateFieldValueData = { fieldId: number; value: string | null }
export type CreateItemData = {
  name: string
  description: string
  quantity: number
  unit: string | null
  itemTypeId: number
  locationId: number | null
  createdBy: number
  published: boolean
  fieldValues: CreateFieldValueData[]
}

// Insert the item row AND its custom-field value rows in a single transaction.
// Returns the created item row (hydration happens in the service layer).
export const createItem = (db: DrizzleDb, data: CreateItemData): ItemRow =>
  db.transaction((tx) => {
    const created = tx
      .insert(items)
      .values({
        name: data.name,
        description: data.description,
        quantity: data.quantity,
        unit: data.unit,
        itemTypeId: data.itemTypeId,
        locationId: data.locationId,
        createdBy: data.createdBy,
        published: data.published,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning(ITEM_FIELDS)
      .get()
    for (const fv of data.fieldValues) {
      tx.insert(itemCustomFieldValues).values({ itemId: created.id, fieldId: fv.fieldId, value: fv.value }).run()
    }
    reindexItem(tx as unknown as DrizzleDb, created.id)
    return created
  })

export type UpdateItemData = Partial<Pick<CreateItemData, 'name' | 'description' | 'quantity' | 'unit' | 'itemTypeId' | 'locationId' | 'published'>>

export const updateItem = (db: DrizzleDb, id: number, data: UpdateItemData): ItemRow | undefined =>
  db
    .update(items)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning(ITEM_FIELDS)
    .get()

export const deleteItem = (db: DrizzleDb, id: number): boolean => db.delete(items).where(eq(items.id, id)).run().changes > 0

// Unpublished items only, for the drafts page. No FTS join — a draft may not be in
// items_fts (it always is, but keep this independent of the search path).
export const listDraftItems = (db: DrizzleDb): ItemRow[] =>
  db.select(ITEM_FIELDS).from(items).where(eq(items.published, false)).orderBy(desc(items.createdAt)).all()

// Flip the published flag. Returns whether the item existed.
export const setItemPublished = (db: DrizzleDb, id: number, published: boolean): boolean =>
  db.update(items).set({ published, updatedAt: new Date() }).where(eq(items.id, id)).run().changes > 0

// Replace an item's whole custom-field value set: delete the existing rows,
// then insert the new ones. Does NOT open its own transaction — it is always
// called from within `service.updateItem`'s transaction, so it operates
// directly on the passed `db`/`tx` handle so the delete+insert+reindex commit
// atomically.
export const replaceFieldValues = (db: DrizzleDb, itemId: number, fieldValues: CreateFieldValueData[]): void => {
  db.delete(itemCustomFieldValues).where(eq(itemCustomFieldValues.itemId, itemId)).run()
  for (const fv of fieldValues) {
    db.insert(itemCustomFieldValues).values({ itemId, fieldId: fv.fieldId, value: fv.value }).run()
  }
}

// ---------------------------------------------------------------------------
// Child-table queries. All batch: `list` hydrates many items without N+1, and
// single-item hydration reuses them with a one-element id array.
// ---------------------------------------------------------------------------

// Custom-field values joined with their field definition rows to expose
// `fieldName`/`fieldType` for hydration.
export const listCustomFields = (db: DrizzleDb, itemIds: number[]): CustomFieldValueRow[] =>
  db
    .select({
      itemId: itemCustomFieldValues.itemId,
      fieldId: itemCustomFieldValues.fieldId,
      value: itemCustomFieldValues.value,
      fieldName: itemTypeFields.name,
      fieldType: itemTypeFields.fieldType,
    })
    .from(itemCustomFieldValues)
    .innerJoin(itemTypeFields, eq(itemCustomFieldValues.fieldId, itemTypeFields.id))
    .where(inArray(itemCustomFieldValues.itemId, itemIds))
    .all()

export const listTypeRefsById = (db: DrizzleDb, ids: number[]): TypeRefRow[] =>
  db.select({ id: itemTypes.id, name: itemTypes.name }).from(itemTypes).where(inArray(itemTypes.id, ids)).all()

export const listLocationRefsById = (db: DrizzleDb, ids: number[]): LocationRefRow[] =>
  db.select({ id: locations.id, name: locations.name }).from(locations).where(inArray(locations.id, ids)).all()

export const listTags = (db: DrizzleDb, itemIds: number[]): TagRow[] =>
  db
    .select({ itemId: itemTags.itemId, id: tags.id, name: tags.name, color: tags.color })
    .from(itemTags)
    .innerJoin(tags, eq(itemTags.tagId, tags.id))
    .where(inArray(itemTags.itemId, itemIds))
    .all()

export const listImages = (db: DrizzleDb, itemIds: number[]): ImageRow[] =>
  db
    .select({ itemId: images.itemId, id: images.id, originalPath: images.originalPath, editedPath: images.editedPath, thumbPath: images.thumbPath, isPrimary: images.isPrimary })
    .from(images)
    .where(inArray(images.itemId, itemIds))
    .all()
