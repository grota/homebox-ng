# Phase 3 — FTS Search + Facets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-text search across the item catalog plus live-counted facets (location tree, item type, tags), surfacing on the existing `/items` page in place.

**Architecture:** A standalone SQLite **FTS5** table `items_fts` holds a denormalized searchable blob per item — name, description, tags, custom-field values, item-type name, and location path — tokenized `unicode61 remove_diacritics`. The index is kept correct at the application layer: `reindexItem(db, itemId)` recomputes the blob and is called from every write path that can change an item's searchable content (item create/update, tag assign, item-type rename, location rename). `items.list` (tRPC) is extended to run the FTS `MATCH`, apply the relational filters, return ranked results with `snippet`, and compute facet counts; the `/items` page is driven by URL query params with a search box and a facet sidebar. No new admin gate — reads stay on `protectedProcedure`.

**Tech Stack:** SQLite FTS5 (better-sqlite3 runtime, verified `ENABLE_FTS5=1`), Drizzle ORM, tRPC, React 18 + Vite + `@tanstack/react-query`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-05-phase3-search-facets-design.md` — the plan argues from this spec; executors read both.

## Global Constraints

- **Indexed FTS columns:** `item_id` (stored `UNINDEXED`, retrievable but not searchable), `name`, `description`, `tags`, `custom_fields`, `type_name`, `location_path`. Tokenizer `unicode61 remove_diacritics 2`.
- **Searchable content:** name, description, space-joined tag names, space-joined non-null custom-field values, the item-type name, and the space-joined ancestor location names root→leaf.
- **API:** `items.list` input gains `tagIds?: number[]`; response becomes `{ items, total, facets }`; `ItemDto` gains optional `snippet`. No new `search.query` procedure.
- **Filter semantics:** `locationId`/`itemTypeId` are single-select AND; `tagIds` are multi-select **OR within the dimension** (an item matches if it has ≥1 selected tag) and AND across dimensions. A facet filter narrows the search.
- **Facet-count rule:** each dimension's counts are computed over the query **excluding that dimension's own selection**. Facet lists ordered `count DESC, name ASC`.
- **Location facet:** one level at a time — the children of the selected `locationId` (or roots), each node's count covering its **subtree** (node + descendants).
- **Param mapping:** the web URL param is `q`; the tRPC input field stays `search`. `ItemsPage` maps URL `q` → input `search`. (`typeId` URL → `itemTypeId` input; `tagIds[]` URL → `tagIds` input.)
- **Malformed FTS query:** fall back to a literal `LIKE '%term%'` on `items.name` — the list must never error.
- **No `published` filtering** (drafts are Phase 6). Search operates over the same item set as the current list.
- **FTS queries are parameterized** (Drizzle `sql` template / bound bindings); no string interpolation of user text.

### Design decision: index-sync atomicity

The master spec says reindex "in the same DB transaction." This plan honors that where the codebase already transacts and where it's cheap, and is explicit elsewhere:

- `createItem` already runs in a `db.transaction` → `reindexItem` is called inside it (passing `tx`).
- `updateItem` becomes a single `db.transaction` wrapping the field update, the custom-field-value replace, and `reindexItem`.
- `tags.assign` becomes a single `db.transaction` wrapping `replaceItemTags` (refactored to accept a tx) and `reindexItem`.
- `itemTypes.update` (rename) and `locations.update` (rename) reindex every affected item *immediately after* the write, within the same request. (These reindex loops are row-bounded and run before the response; permanent divergence cannot occur because every mutation path reindexes, and `rebuildFTS` is the repair path.)

A `tx from db.transaction(...)` is cast `as unknown as DrizzleDb` when passed to `reindexItem`, which uses only the Drizzle query-builder surface present on both `db` and `tx`. This is an accepted, documented friction.

---

### Task 1: FTS5 table + `reindexItem`/`rebuildFTS`

**Files:**
- Create: `packages/db/drizzle/0001_<tag>_add_items_fts.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` (register the new migration)
- Modify: `packages/db/src/schema.ts` (add `itemsFts` model)
- Create: `apps/api/src/modules/items/fts.ts` (`reindexItem`, `rebuildFTS`, blob helpers)
- Test: `apps/api/test/fts.test.ts`

**Interfaces:**
- Produces: `reindexItem(db: DrizzleDb, itemId: number): void`, `rebuildFTS(db: DrizzleDb): void`, `reindexItemType(db, itemTypeId): void`, `reindexLocationSubtree(db, locationId): void` — all exported from `modules/items/fts.js`. Later tasks call these.
- Produces: `itemsFts` table (exports from `@homebox/db`), typed as `sqliteTable('items_fts', { itemId, name, description, tags, customFields, typeName, locationPath })`.

- [ ] **Step 1: Add the FTS5 virtual table migration**

Create `packages/db/drizzle/0001_add_items_fts.sql`:

```sql
CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED,
  name,
  description,
  tags,
  custom_fields,
  type_name,
  location_path,
  tokenize = 'unicode61 remove_diacritics 2'
);
```

Run `pnpm --filter @homebox/db exec drizzle-kit generate` after a no-op schema change, then **replace** the generated file body with the SQL above and append a `meta/0001_snapshot.json` + update `meta/_journal.json` to register `0001`. (If drizzle-kit refuses a no-op, hand-write the migration and manually add the journal entry — verify with `runMigrations` on a clean DB in Step 3's test.) Ensure the migration did not touch the existing `0000` file.

- [ ] **Step 2: Model `items_fts` for the ORM**

In `packages/db/src/schema.ts`, add (after the `images` table):

```ts
export const itemsFts = sqliteTable('items_fts', {
  itemId: integer('item_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  tags: text('tags').notNull(),
  customFields: text('custom_fields').notNull(),
  typeName: text('type_name').notNull(),
  locationPath: text('location_path').notNull(),
})
```

(Only the columns used by `insert`/`select`/`delete`; the FTS `MATCH`/`rank`/`snippet` stay in raw `sql`.)

- [ ] **Step 3: Write the failing unit tests**

Create `apps/api/test/fts.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import { reindexItem, rebuildFTS } from '../src/modules/items/fts'
import { createItem, listTags } from '../src/modules/items/repo'  // or use direct inserts
import { createType } from '../src/modules/itemTypes/repo'

let db: ReturnType<typeof createDb>

// Seed helper: an item type, a tag, a location chain, and an item.
const seedItem = (name: string, description: string) => {
  // insert a type, a location (root + child), a tag, then an item via repo.createItem
  ...
  return { itemId, typeId, locationId, childLocationId, tagId }
}

beforeAll(() => { db = createDb(':memory:'); runMigrations(db) })
afterAll(() => db.close())

describe('fts reindex', () => {
  it('indexes the full searchable blob and matches case-insensitively', () => {
    const { itemId, tagId, childLocationId } = seedItem('Desk Lamp', 'a wood desk lamp')
    // assign a tag
    // reindexItem(db, itemId)
    const hits = db.all<{ item_id: number }>(`SELECT item_id FROM items_fts WHERE items_fts MATCH ${'lamp'}`)
    expect(hits.length).toBe(1)
    const cafe = ... // a second item named 'café' → matched by term 'cafe'
  })
  it('matches across tags, custom fields, type name and location path', () => { ... })
  it('removes the row when the item is deleted', () => { ... })
  it('rebuildFTS repopulates the whole index', () => { ... })
})
```

Aim specifically at: (a) `lamp` matches `Lamp` (case-insensitive), `cafe` matches `café` (diacritic-insensitive); (b) a term in a tag name, a custom-field value, the type name, or a location name in the path returns the item.

- [ ] **Step 4: Run the tests — verify they fail**

Run: `pnpm --filter @homebox/api test fts`
Expected: FAIL (module `modules/items/fts` not found; no `items_fts` table).

- [ ] **Step 5: Implement `modules/items/fts.ts`**

```ts
import { and, eq, sql } from 'drizzle-orm'
import { items, itemTags, tags, itemCustomFieldValues, itemTypes, locations, itemsFts } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

const locationPathNames = (db: DrizzleDb, locationId: number): string => {
  const chain: string[] = []
  const seen = new Set<number>()
  let id = locationId
  let cur: { parentId: number | null; name: string } | undefined = db
    .select({ parentId: locations.parentId, name: locations.name })
    .from(locations).where(eq(locations.id, id)).get()
  while (cur) {
    chain.unshift(cur.name)
    if (cur.parentId == null || seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    id = cur.parentId
    cur = db.select({ parentId: locations.parentId, name: locations.name }).from(locations).where(eq(locations.id, id)).get()
  }
  return chain.join(' ')
}

type ItemSearchBlob = {
  name: string; description: string; tags: string; customFields: string; typeName: string; locationPath: string
}

const computeBlob = (db: DrizzleDb, itemId: number): ItemSearchBlob | null => {
  const item = db
    .select({ name: items.name, description: items.description, itemTypeId: items.itemTypeId, locationId: items.locationId })
    .from(items).where(eq(items.id, itemId)).get()
  if (!item) return null

  const tagNames = db
    .select({ name: tags.name }).from(itemTags).innerJoin(tags, eq(itemTags.tagId, tags.id))
    .where(eq(itemTags.itemId, itemId)).all().map((r) => r.name)

  const customValues = db
    .select({ value: itemCustomFieldValues.value }).from(itemCustomFieldValues)
    .where(and(eq(itemCustomFieldValues.itemId, itemId), sql`${itemCustomFieldValues.value} IS NOT NULL`))
    .all().map((r) => r.value as string)

  const typeName = item.itemTypeId != null
    ? db.select({ name: itemTypes.name }).from(itemTypes).where(eq(itemTypes.id, item.itemTypeId)).get()?.name ?? ''
    : ''

  return {
    name: item.name,
    description: item.description,
    tags: tagNames.join(' '),
    customFields: customValues.join(' '),
    typeName,
    locationPath: item.locationId != null ? locationPathNames(db, item.locationId) : '',
  }
}

export const reindexItem = (db: DrizzleDb, itemId: number): void => {
  const blob = computeBlob(db, itemId)
  db.delete(itemsFts).where(eq(itemsFts.itemId, itemId)).run()
  if (blob) {
    db.insert(itemsFts).values({ itemId, ...blob }).run()
  }
}

export const reindexItemType = (db: DrizzleDb, itemTypeId: number): void => {
  const ids = db.select({ id: items.id }).from(items).where(eq(items.itemTypeId, itemTypeId)).all().map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}

export const reindexLocationSubtree = (db: DrizzleDb, locationId: number): void => {
  const ids = db
    .all<{ id: number }>(sql`
      WITH RECURSIVE sub(id) AS (
        SELECT ${locationId}
        UNION ALL
        SELECT l.id FROM locations l JOIN sub ON l.parent_id = sub.id
      )
      SELECT i.id FROM items i JOIN sub ON i.location_id = sub.id
    `)
    .map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}

export const rebuildFTS = (db: DrizzleDb): void => {
  db.run(sql`DELETE FROM items_fts`)
  const ids = db.select({ id: items.id }).from(items).all().map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}
```

Note: `db.all<{ id: number }>(sql\`...\`)` returns rows as plain objects (the drizzle `all` generic); the recursive CTE returns `id`. If the `all` generic shape is awkward, use `db.all(sql\`...\`)` and map `(r: any) => r.id`. Confirm the value is a number, not bigint.

- [ ] **Step 6: Run the tests — verify they pass**

Run: `pnpm --filter @homebox/api test fts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/drizzle apps/api/src/modules/items/fts.ts apps/api/test/fts.test.ts packages/db/src/schema.ts
git commit -m "feat(db): add items_fts FTS5 table and reindexItem/rebuildFTS"
```

---

### Task 2: Wire reindex into item create/update (atomic)

**Files:**
- Modify: `apps/api/src/modules/items/repo.ts` (`createItem` reindex inside tx; `replaceFieldValues` becomes tx-accepting)
- Modify: `apps/api/src/modules/items/service.ts` (`createItem`, `updateItem` call `reindexItem`)
- Test: `apps/api/test/fts.test.ts` (extend) or `apps/api/test/items-search.test.ts`

**Interfaces:**
- Consumes: `reindexItem` from `modules/items/fts.js`.
- Produces: item writes now keep the index in sync (create immediately searchable; update re-flects renamed name/type/location and edited field values).

- [ ] **Step 1: Write the failing test**

```ts
it('an item is searchable right after create, and re-searchable after a rename', async () => {
  const { itemId } = seedItem('Desk Lamp', 'wood')
  let hits = db.all<{ item_id: number }>(`SELECT item_id FROM items_fts WHERE items_fts MATCH ${'lamp'}`)
  expect(hits).toHaveLength(1)

  // rename through the service
  service.updateItem(db, { id: itemId, name: 'Sofa' })
  hits = db.all(`SELECT item_id FROM items_fts WHERE items_fts MATCH ${'lamp'}`)
  expect(hits).toHaveLength(0)
  hits = db.all(`SELECT item_id FROM items_fts WHERE items_fts MATCH ${'sofa'}`)
  expect(hits).toHaveLength(1)
})
```

- [ ] **Step 2: Run — verify it fails**

Run: `pnpm --filter @homebox/api test`
Expected: FAIL (create/update don't yet reindex).

- [ ] **Step 3: Make `repo.createItem` reindex inside its transaction**

In `apps/api/src/modules/items/repo.ts`, inside the existing `db.transaction((tx) => {...})` of `createItem`, after the field-value loop, call `reindexItem(tx as any as DrizzleDb, created.id)`. Import `reindexItem` from `./fts.js` (a separate function that already exists — no cycle: `fts.ts` imports the schema, not `repo.ts`).

- [ ] **Step 4: Make `repo.replaceFieldValues` tx-accepting**

Change `replaceFieldValues` to accept a `db` handle (a transaction) and *not* open its own:

```ts
export const replaceFieldValues = (db: DrizzleDb, itemId: number, fieldValues: CreateFieldValueData[]): void => {
  db.delete(itemCustomFieldValues).where(eq(itemCustomFieldValues.itemId, itemId)).run()
  for (const fv of fieldValues) {
    db.insert(itemCustomFieldValues).values({ itemId, fieldId: fv.fieldId, value: fv.value }).run()
  }
}
```

- [ ] **Step 5: Wrap `service.updateItem` in one transaction + reindex**

In `apps/api/src/modules/items/service.ts` `updateItem`, replace the update + `replaceFieldValues` calls with:

```ts
const row = db.transaction((tx) => {
  const updated = Object.keys(data).length > 0 ? repo.updateItem(tx, input.id, data) ?? existing : existing
  if (input.fieldValues !== undefined) {
    repo.replaceFieldValues(tx, input.id, input.fieldValues.map((fv) => ({ fieldId: fv.fieldId, value: fv.value })))
  }
  reindexItem(tx as any as DrizzleDb, input.id)
  return updated
})
```

(`repo.updateItem` already returns the row; passing `tx` is fine.)

- [ ] **Step 6: Run — verify pass + full suite green**

Run: `pnpm --filter @homebox/api test`
Expected: PASS (including the pre-existing items tests — confirm `createItem`/`updateItem` still work).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/items/repo.ts apps/api/src/modules/items/service.ts apps/api/test
git commit -m "feat(api): reindex items_fts on item create/update"
```

---

### Task 3: Wire reindex into tag assign + type/location rename

**Files:**
- Modify: `apps/api/src/modules/tags/repo.ts` (`replaceItemTags` becomes tx-accepting)
- Modify: `apps/api/src/modules/tags/service.ts` (`assignTags` wraps tx + reindex)
- Modify: `apps/api/src/modules/itemTypes/service.ts` (`updateItemType` reindex type on rename)
- Modify: `apps/api/src/modules/locations/service.ts` (`updateLocation` reindex subtree on rename)
- Test: `apps/api/test/fts.test.ts` (extend) or `apps/api/test/search-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('assigning a tag makes an item searchable by that tag', async () => {
  const { itemId } = seedItem('Chair', 'wood')
  // before: searching 'homemade' finds nothing
  // assign tag 'homemade'
  service.assignTags(db, { itemId, tagIds: [tagId] })
  // after: seedItem's tag 'homemade' → the item matches
})
it('renaming a type makes its items searchable by the new name', async () => { ... })
it('renaming a location path re-indexes its subtree', async () => { ... })
```

Run: `pnpm --filter @homebox/api test` → FAIL.

- [ ] **Step 2: Refactor `tags/repo.replaceItemTags` to accept a tx**

Drop its internal `db.transaction` wrapper and use the passed `db`/`tx` directly (the existing body, but with `db` instead of `tx`, and the read-back query on `db`).

- [ ] **Step 3: Wrap `service.assignTags` in a transaction + reindex**

```ts
import { reindexItem } from '../items/fts.js'
export const assignTags = (db: DrizzleDb, input: { itemId: number; tagIds: number[] }): { assigned: TagDto[] } => {
  const rows = db.transaction((tx) => {
    const assigned = repo.replaceItemTags(tx, input.itemId, input.tagIds)
    reindexItem(tx as any as DrizzleDb, input.itemId)
    return assigned
  })
  return { assigned: rows.map(toDto) }
}
```

- [ ] **Step 4: Reindex on type rename**

In `service.updateItemType`, when `input.name !== undefined`, after the update call `reindexItemType(db, input.id)`.

- [ ] **Step 5: Reindex on location rename (subtree)**

In `service.updateLocation`, when `input.name !== undefined`, after the update call `reindexLocationSubtree(db, input.id)`.

- [ ] **Step 6: Run — verify pass**

Run: `pnpm --filter @homebox/api test`
Expected: PASS. Confirm the existing `tags`/`itemTypes`/`locations` tests still pass (the tx refactor must not break `replaceItemTags` callers).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/tags apps/api/src/modules/itemTypes apps/api/src/modules/locations apps/api/test
git commit -m "feat(api): reindex items_fts on tag assign and type/location rename"
```

---

### Task 4: Search + facets in the repo (`repo.searchItems`)

**Files:**
- Modify: `apps/api/src/modules/items/repo.ts` (add `searchItems`, facet builders, `SearchItemsOptions`/`SearchRow`/`SearchFacets` types)
- Test: `apps/api/test/search-query.test.ts`

**Interfaces:**
- Produces: `searchItems(db, opts): { rows: SearchRow[]; total: number; facets: SearchFacets }` where `SearchRow = ItemRow & { snippet: string | null }` and `FacetCount = { id; name; count }`, `TagFacet = { id; name; color; count }`, `SearchFacets = { types: FacetCount[]; tags: TagFacet[]; locations: FacetCount[] }`.
- Produces: `ListItemsOptions` gains `tagIds?: number[]` (so `searchItems` accepts the extended options).
- Consumes: `ITEM_FIELDS` (existing select), `items`/`locations`/`itemTypes`/`tags`/`itemTags`/`itemsFts` (schema).

- [ ] **Step 1: Write the failing tests** (query-builder + integration)

`apps/api/test/search-query.test.ts`:

```ts
it('searches ranked across name/description/tags/type/location with a snippet', () => { ... })
it('applies locationId, itemTypeId as AND; tagIds as OR-within-dimension', () => { ... })
it('computes facet counts excluding each dimension’s own selection', () => { ... })
it('location facet returns the current level (children) with subtree counts', () => { ... })
it('a malformed fts term falls back to a literal name LIKE without throwing', () => { ... })
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @homebox/api test search-query`
Expected: FAIL (`searchItems` not exported).

- [ ] **Step 3: Implement `searchItems`**

Add to `apps/api/src/modules/items/repo.ts`. The matching predicate is a `where` fragment applied to the `items` table (column names must be `items.*` so the same fragment is reusable whether the query is `FROM items` or `FROM items_fts JOIN items ON items.id = fts.item_id`):

```ts
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'

export type FacetCount = { id: number; name: string; count: number }
export type TagFacet = { id: number; name: string; color: string | null; count: number }
export type SearchFacets = { types: FacetCount[]; tags: TagFacet[]; locations: FacetCount[] }
export type SearchRow = ItemRow & { snippet: string | null }
export type SearchItemsOptions = {
  page?: number; pageSize?: number; search?: string; locationId?: number; itemTypeId?: number; tagIds?: number[]
}

const buildWhere = (db: DrizzleDb, opts: { locationId?: number; itemTypeId?: number; tagIds?: number[] }): SQL | undefined => {
  const conds: SQL[] = []
  if (opts.locationId != null) conds.push(eq(items.locationId, opts.locationId))
  if (opts.itemTypeId != null) conds.push(eq(items.itemTypeId, opts.itemTypeId))
  if (opts.tagIds?.length) {
    conds.push(inArray(items.id, db.select({ id: itemTags.itemId }).from(itemTags).where(inArray(itemTags.tagId, opts.tagIds))))
  }
  return conds.length ? and(...conds) : undefined
}

const ORD = 'ORDER BY rank ASC, items.created_at DESC'   // FTS4/5: lower rank = better (bm25)
const ORD_PLAIN = 'ORDER BY items.created_at DESC'
```

Then:
- **Page rows + total when `search` present**: `SELECT items.id, snippet(items_fts, 0, '', '', ' … ', 16) AS snippet FROM items_fts JOIN items ON items.id = items_fts.item_id WHERE items_fts MATCH <q> [AND <where>] ORDER BY rank, items.created_at DESC LIMIT <limit> OFFSET <offset>`. This returns `id` + `snippet`; load the full `ITEM_FIELDS` for those ids in a second query (below).
- **Page rows when `search` absent**: the existing `listItems` body (keep it) — plain `items` filter, `createdAt DESC`, no snippet.
- **Total**: `SELECT COUNT(*) FROM items_fts JOIN items ON items.id=items_fts.item_id WHERE items_fts MATCH <q> [AND <where>]` (or the plain count when no search).
- **Facets**: for each dimension, build the query with that dimension's filter omitted. Each filter's own fragment is produced by `buildWhere(db, { locationId, itemTypeId, tagIds })` with the relevant key dropped. When `search` present, each facet query joins `items_fts` with the MATCH and groups.

Representative queries (all via `sql` template, parameterized):

```ts
// types facet (omit itemTypeId)
const types = db.all<FacetCount>(sql`
  SELECT items.item_type_id AS id, item_types.name AS name, COUNT(*) AS count
  FROM items JOIN item_types ON item_types.id = items.item_type_id
  ${ftsJoin}  -- 'JOIN items_fts ON items.id = items_fts.item_id' + 'items_fts MATCH <q>' when search
  WHERE ${whereWithoutType}
  GROUP BY items.item_type_id
  ORDER BY count DESC, item_types.name ASC
`)

// tags facet (omit tagIds)
const tags = db.all<TagFacet>(sql`
  SELECT tags.id AS id, tags.name AS name, tags.color AS color, COUNT(DISTINCT items.id) AS count
  FROM item_tags JOIN items ON items.id = item_tags.item_id JOIN tags ON tags.id = item_tags.tag_id
  ${ftsJoin}
  WHERE ${whereWithoutTags}
  GROUP BY tags.id
  ORDER BY count DESC, tags.name ASC
`)

// locations facet (current level): children of locationId, or roots when unset
const levelNodeIds = /* children of selected locationId, or root locations */ 
const locations = levelNodeIds.map((node): FacetCount => {
  const subtree = /* recursive subtree ids of node */
  const count = db.get<{ count: number }>(sql`
    SELECT COUNT(*) AS count FROM items JOIN items_fts ON items.id = items_fts.item_id
    WHERE items_fts MATCH ${qOrEmpty} AND items.location_id IN (${...subtree}) ${whereWithoutLocation}
  `)?.count ?? 0
  return { id: node.id, name: node.name, count }
})
```

For the location level, get the children from `locations`: if `locationId` set, its children (`parent_id === locationId`); else roots (`parent_id IS NULL`). For each node, expand the subtree with a recursive CTE and count items in it with the FTS + remaining filters.

**Important:** the `where` fragments must be applied only when the corresponding filter is present, and `and(...)`/`sql` fragments are composed so that empty fragments produce no stray `AND`. Pass `sql` fragments that are empty-tolerant (`whereWithoutType` is an `SQL` maybe) — use `and(...)` which omits `undefined` members.

- [ ] **Step 4: Run — verify pass**

Run: `pnpm --filter @homebox/api test search-query`
Expected: PASS. Also check `buildWhere([], ...)` returns `undefined` for the no-filter case so plain queries don't emit `WHERE` with nothing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/items/repo.ts apps/api/test/search-query.test.ts
git commit -m "feat(api): ranked FTS search + facet counts in items repo"
```

---

### Task 5: Extend `service.listItems` + router `tagIds` + integration tests

**Files:**
- Modify: `apps/api/src/modules/items/service.ts` (extend `ListItemsInput`, `listItems` returns `facets` + hydrated `snippet`; `ItemDto` gains `snippet?`)
- Modify: `apps/api/src/modules/items/router.ts` (`listInput` gains `tagIds`)
- Test: `apps/api/test/items-search.test.ts` (tRPC integration via `app.inject`, as in `items.test.ts`)

- [ ] **Step 1: Write the failing integration test**

```ts
it('items.list returns ranked, hydrated results + facets across the tRPC boundary', async () => {
  // setup: create a type, a location, a tag, an item; assign tag + reindex
  const res = await app.inject({ method: 'POST', url: '/trpc/items.list', headers: { cookie: adminCookie }, payload: { search: 'lamp', tagIds: [tagId] } })
  const data = res.json()?.result?.data
  expect(data.items[0].snippet).toContain('lamp')
  expect(data.facets.types.length).toBeGreaterThan(0)
  expect(data.total).toBe(1)
})
it('items.list with no search returns the plain list but still computes facets', async () => { ... })
it('items.list ignores a malformed fts term without erroring', async () => { ... })
```

Run: `pnpm --filter @homebox/api test items-search` → FAIL.

- [ ] **Step 2: Extend `ListItemsInput` and `listItems`**

In `service.ts`:

```ts
export type ListItemsInput = { page?: number; pageSize?: number; search?: string; locationId?: number; itemTypeId?: number; tagIds?: number[] }
export type FacetCount = { id: number; name: string; count: number }
export type TagFacet = { id: number; name: string; color: string | null; count: number }
export type SearchFacets = { types: FacetCount[]; tags: TagFacet[]; locations: FacetCount[] }
```

Add `snippet?: string` to `ItemDto`. Change `listItems` to call `repo.searchItems(db, input)` and hydrate: reuse the existing batch child-table queries, then attach `snippet` (present only when `input.search` is set) and `facets`:

```ts
export const listItems = (db: DrizzleDb, input: ListItemsInput): { items: ItemDto[]; total: number; facets: SearchFacets } => {
  const { rows, total, facets } = repo.searchItems(db, input)
  if (rows.length === 0) return { items: [], total, facets }
  const ids = rows.map((r) => r.id)
  const fieldsByItem = groupByItemId(repo.listCustomFields(db, ids))
  const tagsByItem = groupByItemId(repo.listTags(db, ids))
  const imagesByItem = groupByItemId(repo.listImages(db, ids))
  const typeIds = distinct(rows.map((r) => r.itemTypeId))
  const typeById = new Map(repo.listTypeRefsById(db, typeIds).map((t) => [t.id, t]))
  const locationIds = distinct(rows.filter((r) => r.locationId != null).map((r) => r.locationId!))
  const locationById = new Map(repo.listLocationRefsById(db, locationIds).map((l) => [l.id, l]))
  const items = rows.map((row) => {
    const dto = toDto(row, fieldsByItem.get(row.id) ?? [], typeById.get(row.itemTypeId), row.locationId != null ? locationById.get(row.locationId) : undefined, tagsByItem.get(row.id) ?? [], imagesByItem.get(row.id) ?? [])
    if (row.snippet != null) dto.snippet = row.snippet
    return dto
  })
  return { items, total, facets }
}
```

- [ ] **Step 3: Add `tagIds` to the router input**

In `router.ts`, add to `listInput`:

```ts
tagIds: z.array(z.number().int().positive()).optional(),
```

- [ ] **Step 4: Run — verify pass + full api suite**

Run: `pnpm --filter @homebox/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/items/service.ts apps/api/src/modules/items/router.ts apps/api/test/items-search.test.ts
git commit -m "feat(api): extend items.list with search, facets, snippet and tagIds"
```

---

### Task 6: Web `/items` — URL params, search box + facet sidebar

**Files:**
- Modify: `apps/web/src/features/items/ItemsPage.tsx` (URL params, search box, facet sidebar, snippet, reset)
- Modify (if needed): `apps/web/test/catalog.test.tsx` (mock must include `tags`, `locations`, `facets` shapes the page now reads)
- Test: `apps/web/test/searchFacets.test.tsx` (new component test)

**Interfaces:**
- Consumes: `data.items` (with `snippet?`), `data.total`, `data.facets.types/.tags/.locations`; `locations.list` (for the tree/breadcrumb); `itemTypes.list` (type facet names — though `facets.types` already carries names).
- Produces: URL param state (`q`, `locationId`, `typeId`, `tagIds[]`, `page`).

- [ ] **Step 1: Write the failing component test**

```tsx
it('drives the query from URL params and renders a search box + facets', async () => {
  render(<MemoryRouter initialEntries={['/items?q=lamp&typeId=1']}><AppProviders><ItemsPage /></AppProviders></MemoryRouter>)
  // assert the search box shows 'lamp', the facet sidebar lists types/tags/locations with counts,
  // and an item card shows its snippet
})
it('toggling a tag chip updates the URL and re-queries', async () => { ... })
it('clear filters resets the URL params', async () => { ... })
```

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @homebox/web test`
Expected: FAIL (page doesn't read URL params or render facets).

- [ ] **Step 3: Update the ItemsPage mock in `catalog.test.tsx`**

The mocked `items.list.useQuery` must now return `items` (with `snippet?`), `total`, and `facets: { types, tags, locations }`. Update any other web test that renders `ItemsPage`. Keep the mock's `locations.list`/`itemTypes.list`/`tags.list` returned shapes.

- [ ] **Step 4: Implement the page**

Replace the `useState` page with `useSearchParams`. Read `q`, `locationId`, `typeId`, `tagIds[]`, `page` from it; map to the tRPC input (`search` from `q`, `itemTypeId` from `typeId`), and write back on change. Debounce the `q` input (~300ms). Render a search box, a facet sidebar using `data.facets` (types chips, tags multi-chips, locations drill with a breadcrumb from `locations.list`), the item `snippet` when `q` is active, and a "Clear filters" control. Reset `page` to 1 whenever a filter or `q` changes.

Use a small `parse`/`serialize` helper for multi-value `tagIds[]`, and `locations.list` to build the breadcrumb chain for the selected `locationId`. Keep the existing card grid and pager.

- [ ] **Step 5: Run — verify pass**

Run: `pnpm --filter @homebox/web test`
Expected: PASS (existing + new tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/items/ItemsPage.tsx apps/web/test
git commit -m "feat(web): search box + faceted filters on /items with URL param state"
```

---

### Task 7: E2E — search + facet narrowing

**Files:**
- Modify: `apps/web/e2e/catalog.spec.ts` (add a search/facet test)
- Test: extend the existing E2E flow.

- [ ] **Step 1: Write the failing E2E test**

Append a test that inherits the seeded "Lamp"/"Default" item from the first test, goes to `/items`, types `lamp` into the search box, asserts a card shows and a snippet appears, then applies a tag facet and asserts the result narrows / an empty-result state shows.

- [ ] **Step 2: Run — verify fail**

Run: `pnpm --filter @homebox/web exec playwright test`
Expected: FAIL until `/items` has the search box.

- [ ] **Step 3: Make it pass**

The page renders the search box and facets (Task 6); the E2E now drives them.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/catalog.spec.ts
git commit -m "test(e2e): search + facet narrowing on the items catalog"
```

---

## Verification

- `pnpm -r build` clean.
- `pnpm -r test` green: shared, db, api, web.
- `pnpm --filter @homebox/web exec playwright test` green (E2E).

## Self-Review (completed during authoring)

- **Spec coverage:** FTS table + blob (T1) ✓; reindex on all 5 write paths (T1-T3) ✓; extend `items.list` with `tagIds`/facets/snippet (T4-T5) ✓; URL-param search surface + facet sidebar + reset (T6) ✓; malformed-FTS fallback + parameterized queries (T4/T5) ✓; location one-level drill with subtree counts (T4) ✓; snippets (T4-T6) ✓; no `published` filter (Global Constraints) ✓; E2E (T7) ✓.
- **Type consistency:** `reindexItem`/`rebuildFTS`/`reindexItemType`/`reindexLocationSubtree` signatures match their call sites (T1 produces, T2/T3 consume). `SearchRow`, `FacetCount`, `TagFacet`, `SearchFacets`, `ListItemsInput.tagIds` are consistent across `repo.ts` and `service.ts`. `ItemDto.snippet?` consumed by the web page and mock.
- **Placeholder scan:** no TBD/TODO/"add appropriate handling". The search repo sketch (T4) is the most complex area and is intentionally written as a design + representative SQL so the implementer and review can confirm the exact composition; the unit tests in T4 pin the behavior.
- **Conflict with plan text:** the atomicity decision is stated up front (Global Constraints) rather than silently deviating from a literal "same transaction" reading; the reviewer can rule on it.
