import { and, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import { items, itemCustomFieldValues, itemTypeFields, itemTypes, locations, itemTags, tags, images } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { DEFAULT_ITEM_SORT, type ItemSort, type ItemSortPreference } from '@homebox/shared'
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
  trashedAt: Date | null
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
  trashedAt: items.trashedAt,
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
  sort?: ItemSort
}

type RelationalFilters = { locationId?: number; itemTypeId?: number; tagIds?: number[] }

// `LocationRow`-like level node (id + name only) used by the location facet.
type LevelNode = { id: number; name: string }

// `buildWhere` composes the relational filters (and an optional search predicate)
// into a single AND'd fragment. Two base predicates are always present — the item
// must be published and not trashed — so drafts (`published = false`) and trashed
// items leak into neither the catalog, nor search, nor any facet count, all of
// which compose their WHERE through here. The `tagIds` predicate is
// OR-within-dimension: an item matches if it carries AT LEAST ONE of the selected
// tags (membership in the subselect of `item_tags` ids).
const buildWhere = (db: DrizzleDb, filters: RelationalFilters, searchPredicate?: SQL): SQL | undefined => {
  const conds: SQL[] = [eq(items.published, true), isNull(items.trashedAt)] // neither drafts nor trash leak into the catalog or facets
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

// FTS5 matches whole *tokens*: `MATCH 'back'` does not find "background" — it
// looks for the word "back" and finds nothing. So the term is sent as a prefix
// query, `back*`, which is what typing "back" means when you are on your way to
// "background". This is a search box you type into one character at a time; a
// search that only matches complete words is a search that shows you nothing
// until you have already finished typing.
//
// One trailing `*` covers the whole term, multi-word included: FTS5 reads
// `proven back*` as `proven AND back*`. Only the last token is prefixed, which is
// the one you are still typing — prefixing every token would make `vene lamp`
// match "veneer lamp", and the words before it are ones you have already
// finished.
//
// Three terms are left exactly as typed, and they are the escape hatch from the
// prefixing above:
//
//   A term ending in `*` is already a prefix query — `back**` is a syntax error,
//   which would silently drop the whole query to the `LIKE` fallback.
//
//   A term ending in `"` is a *quoted phrase*, and the user wrote the quotes to
//   say exactly that. Prefixing it is what makes `"back"` match "background":
//   measured against SQLite, `"back"` returns 1 row and `"back"*` returns 3. So
//   quotes are how you ask for the word itself rather than any word starting with
//   it — the precise search that always-prefixing would otherwise take away.
//
//   A term ending in `)` is a bracketed group, and `*` cannot follow a bracket.
//
// No new wildcard syntax is invented here on purpose. FTS5 already has the
// operators worth having — `*`, `"`, `AND`/`OR`/`NOT` in capitals, and brackets —
// and anything else is a parser to own: a star in the middle is not an error but
// silently means something else (`ba*ck` returns 0 rows and no complaint), and
// `%` is a syntax error outright.
// A closing bracket is the third: `*` cannot follow one — `(a OR b)*` is a syntax
// error, which would drop the whole query to the literal fallback and make every
// grouped search silently find nothing. Leaving it alone sends the user's own
// syntax exactly as written, at the cost of no prefix on the group's last word.
const prefixTerm = (term: string): string =>
  term.endsWith('*') || term.endsWith('"') || term.endsWith(')') ? term : `${term}*`

const ftsCtx = (term: string): SearchCtx => ({
  predicate: sql`items_fts MATCH ${prefixTerm(term)}`,
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

// Every catalog ordering, and the rule that makes them all *total*.
//
// Each one ends in `items.id`. `items.list` pages with LIMIT/OFFSET, so an
// ordering with ties is one where the tied rows can come back in a different
// order per request — and a row that moves across a page boundary is a row the
// user never sees, or sees twice. That is reachable rather than theoretical: a
// bulk create stamps many items with the same `created_at`, and both an unpack
// and a bulk publish create many items at once.
const ITEM_SORT_SQL: Record<ItemSortPreference, SQL> = {
  'createdAt:desc': sql`items.created_at DESC, items.id DESC`,
  'createdAt:asc': sql`items.created_at ASC, items.id DESC`,
  'updatedAt:desc': sql`items.updated_at DESC, items.id DESC`,
  'updatedAt:asc': sql`items.updated_at ASC, items.id DESC`,
  // `COLLATE NOCASE`, because SQLite's default collation is byte order, which
  // sorts every uppercase name before every lowercase one. That is not a name
  // ordering, and it reads as a bug the first time it is used.
  'name:asc': sql`items.name COLLATE NOCASE ASC, items.id DESC`,
  'name:desc': sql`items.name COLLATE NOCASE DESC, items.id DESC`,
}

// The `ORDER BY` fragment for one request. Ranked search keeps its rank order
// unless a column is asked for — that is what "an explicit order overrides
// relevance" means — and `relevance` with no term falls back to the default,
// because with no term there is no rank to order by.
const orderFor = (sort: ItemSort | undefined, ranked: boolean): SQL => {
  if (ranked && (sort == null || sort === 'relevance')) {
    return sql`rank ASC, items.created_at DESC, items.id DESC`
  }
  return ITEM_SORT_SQL[sort != null && sort !== 'relevance' ? sort : DEFAULT_ITEM_SORT]
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
    ORDER BY ${orderFor(opts.sort, true)}
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
  const rows = db.select(ITEM_FIELDS).from(items).where(where).orderBy(orderFor(opts.sort, false)).limit(pageSize).offset(offset).all()
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
      // FTS5 throws a `SQLITE_ERROR` when it reads the text as *syntax* and the
      // syntax is wrong. Two ways that happens, and both are ordinary typing:
      // a hyphen or a colon is FTS5's column filter (`wd-40` parses as "column
      // wd, term 40"), and an odd number of quotes is an unterminated string.
      //
      // The fix is FTS5's own escaping rule applied to the whole input: wrap it in
      // double quotes, and double any quotes inside it. That is valid for *any*
      // input, so the retry cannot fail on syntax — and it is still a real FTS5
      // search, so results stay ranked, cover every column and carry snippets,
      // unlike the name-only `LIKE` below. The tokenizer then splits `wd-40` into
      // `wd` and `40` on the query side exactly as it did on the document side, so
      // the phrase matches the item that has "wd 40" in it.
      //
      // The trailing `*` sits outside the quotes to keep the last token a prefix;
      // `prefixTerm` leaves the result alone because it already ends in `*`.
      if (isSqliteError(e)) {
        const quoted = `"${term.replace(/"/g, '""')}"*`
        try {
          return runFtsSearch(db, opts, quoted, pageSize, offset)
        } catch {
          // Quoting is total, so this is unreachable — kept as the floor because
          // a literal `LIKE` is the one path that cannot fail on anything.
          return runPlainSearch(db, opts, likeCtx(term), pageSize, offset)
        }
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

// A page window. Built here so the drafts list and the trash list cannot disagree
// about what page 2 means.
export type PageWindow = { limit: number; offset: number }
export const pageWindow = (page = 1, pageSize = 20): PageWindow => ({ limit: pageSize, offset: (page - 1) * pageSize })

// Every draft id, unpaginated — the bulk operations' "all drafts" branch.
//
// Deliberately a different function from `listDraftItems` rather than a
// `listDraftItems(db)` default: if pagination lived behind a defaulted
// parameter, "publish all" would quietly become "publish the first page", and
// nothing would fail. A name that says "all" is the guard.
export const listAllDraftIds = (db: DrizzleDb): number[] =>
  db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.published, false), isNull(items.trashedAt)))
    .all()
    .map((r) => r.id)

// Unpublished, untrashed items only — one page of the drafts list. No FTS join: a
// draft may not be in items_fts (it always is, but keep this independent of the
// search path). The trash guard is here rather than inherited from `buildWhere`:
// this query does not compose through it, which is exactly the kind of site that
// gets missed.
//
// `id` is a second sort key because `createdAt` has second-resolution ties — the
// unpack tests already comment on two drafts sharing a timestamp — and a
// non-total order lets rows repeat or vanish between pages.
export const listDraftItems = (db: DrizzleDb, window: PageWindow): ItemRow[] =>
  db
    .select(ITEM_FIELDS)
    .from(items)
    .where(and(eq(items.published, false), isNull(items.trashedAt)))
    .orderBy(desc(items.createdAt), desc(items.id))
    .limit(window.limit)
    .offset(window.offset)
    .all()

export const countDraftItems = (db: DrizzleDb): number =>
  db
    .select({ c: count() })
    .from(items)
    .where(and(eq(items.published, false), isNull(items.trashedAt)))
    .get()?.c ?? 0

// Flip the published flag. Returns whether the item existed.
export const setItemPublished = (db: DrizzleDb, id: number, published: boolean): boolean =>
  db.update(items).set({ published, updatedAt: new Date() }).where(eq(items.id, id)).run().changes > 0

// Move an item to the trash (`at` a timestamp) or back out of it (`null`) — the
// one write behind trash, restore, and every bulk variant. `published` is
// deliberately untouched: it is what tells a draft from a catalog item, and
// restoring must return the thing to where it came from (ADR-0004).
export const setItemTrashedAt = (db: DrizzleDb, id: number, at: Date | null): boolean =>
  db.update(items).set({ trashedAt: at, updatedAt: new Date() }).where(eq(items.id, id)).run().changes > 0

// Release items from a location that is about to be deleted (ADR-0004). Bulk,
// because the alternative is one UPDATE per item, and it runs inside the
// caller's transaction so a failure leaves no item detached from a location
// that still exists.
export const clearItemLocations = (db: DrizzleDb, ids: number[]): void => {
  if (ids.length === 0) return
  db.update(items).set({ locationId: null, updatedAt: new Date() }).where(inArray(items.id, ids)).run()
}

// Everything in the trash, newest first — the whole point of storing a timestamp.
// Unpaginated, for the bulk purge's "the whole trash" branch; see
// `listAllDraftIds` for why this is not a defaulted parameter.
export const listAllTrashedIds = (db: DrizzleDb): number[] =>
  db.select({ id: items.id }).from(items).where(isNotNull(items.trashedAt)).all().map((r) => r.id)

// One page of the trash. `id` breaks `trashedAt` ties for the same reason
// `createdAt` needs one above.
export const listTrashedItems = (db: DrizzleDb, window: PageWindow): ItemRow[] =>
  db
    .select(ITEM_FIELDS)
    .from(items)
    .where(isNotNull(items.trashedAt))
    .orderBy(desc(items.trashedAt), desc(items.id))
    .limit(window.limit)
    .offset(window.offset)
    .all()

export const countTrashedItems = (db: DrizzleDb): number =>
  db.select({ c: count() }).from(items).where(isNotNull(items.trashedAt)).get()?.c ?? 0

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

// Ordered newest-first, matching `getImagesForItem`, because this is the batch
// path behind every item DTO (`hydrateRows` → `items.get`, `items.list`,
// `trash.list`) and the item surface's "3 of 7" counts *this* array. Without the
// ORDER BY the order was whatever SQLite returned — which happened to look right
// for a freshly created item and was never guaranteed.
export const listImages = (db: DrizzleDb, itemIds: number[]): ImageRow[] =>
  db
    .select({ itemId: images.itemId, id: images.id, originalPath: images.originalPath, editedPath: images.editedPath, thumbPath: images.thumbPath, isPrimary: images.isPrimary })
    .from(images)
    .where(inArray(images.itemId, itemIds))
    .orderBy(desc(images.sortOrder))
    .all()
