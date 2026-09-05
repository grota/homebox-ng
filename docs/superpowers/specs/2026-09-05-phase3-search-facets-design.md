# Phase 3 — FTS search + facets: design

**Parent:** `docs/superpowers/specs/2026-09-04-homebox-bg-design.md` (master)
**Roadmap slot:** Phase 3 (FTS search + facets), per the phase1 plan's spec-coverage note.

## Goal

Add full-text search across the item catalog plus faceted navigation (location tree,
item type, tags) so a user can find items by typing meaning-free text — matching name,
description, tags, custom-field values, item-type name, and location path — and narrow
results with live-counted filters.

**Surface:** the existing `/items` page is enhanced in place with a search box and a facet
sidebar; no separate search page.

**Scope:** the catalog is already shared across all authenticated users, so search and
facets are **protected** (any authenticated user). Drafts (`published=false`) are a Phase 6
concern; this phase does **not** filter on `published` and does not change draft behavior.

## Decisions (locked)

These were surfaced during brainstorming and confirmed:

1. **Search UX:** enhance `/items` in place (query box + facet sidebar), not a new page.
2. **Facet set:** location tree + item type + tags. Custom-field facets are out of scope.
3. **API shape:** extend the existing `items.list` tRPC procedure, not a new `search.query`.
   The designer's intent ("redirect to the same service module used in item CRUD") is
   preserved — the search reuses `items` repo/service hydration.
4. **Malformed FTS query:** fall back to a literal substring match on `name` rather than
   erroring. Search must never hard-fail the list.
5. **Location facet:** one level at a time (breadcrumb to go back up). Each node's count
   covers its **subtree** (the node plus all descendants), so drilling is useful.

## Architecture

- **Search backend:** SQLite **FTS5** standalone content table `items_fts` (verified
  support: runtime SQLite 3.53.4 with `ENABLE_FTS5=1`; `unicode61` + `MATCH` + `snippet`
  all work). The searchable blob is denormalized into the FTS table and kept in sync at the
  **application layer** (`reindexItem`), not via SQL triggers.
- **Indexed columns** of `items_fts`: `name`, `description`, `tags` (tag names joined),
  `custom_fields` (custom-field values joined), `type_name` (item type name), `location_path`
  (ancestor location names joined, root→leaf). `item_id` is stored **`UNINDEXED`** (retrievable,
  not searchable). Tokenizer: `unicode61 remove_diacritics 2` — case- and diacritic-insensitive.
- **API:** `items.list` gains `tagIds?: number[]` and returns `{ items, total, facets }`
  (plus an optional `snippet` on matched items). When `search` is absent the request is the
  existing plain paginated list (behavior unchanged, but `facets` is still returned).
- **Web:** `/items` drives the query from **URL search params** (`?q=`, `?locationId=`,
  `?typeId=`, `?tagIds[]=`, `?page=`), so results are linkable and back/forward works.

## Data layer

### FTS5 table

Migration `packages/db/drizzle/0001_*_add_items_fts.sql` (hand-authored; Drizzle cannot
model a virtual table, so add it via raw SQL alongside the generated migration mechanics):

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

Model `items_fts` in `packages/db/src/schema.ts` as a `sqliteTable('items_fts', {...})` with
`itemId: integer('item_id')`, `name`, `description`, `tags`, `customFields: text('custom_fields')`,
`typeName: text('type_name')`, `locationPath: text('location_path')` so the ORM can `select`
from and `delete`/`insert` into it. The `UNINDEXED`/`MATCH`/`snippet`/`rank` concerns stay in
raw SQL (via `sql`) in the repo layer — Drizzle's query builder does not support `MATCH`.

### Index sync (application-layer, atomic)

`reindexItem(db, itemId)` recomputes the blob and upserts the `item_id` row:

- `name`, `description` from `items`.
- `tags` = space-joined tag names for the item (via `item_tags` → `tags`).
- `custom_fields` = space-joined `item_custom_field_values.value` where `value IS NOT NULL`.
- `type_name` = the item type's `name`.
- `location_path` = space-joined ancestor location names, root→leaf (walk `locations.parent_id`).

It runs **in the same transaction** as every write that can change an item's searchable
content:
- `createItem` / `updateItem` (name, description, itemTypeId, locationId changes).
- tag `assign` to an item (insert/delete `item_tags` edges).
- item custom-field value create/update/replace (`replaceFieldValues`).
- item type or location **rename** (a rename changes every item that references it).

`rebuildFTS(db)` wipes and re-inserts the whole index from scratch — an admin/dev repair
path for when the index drifts.

`reindexItem` is a delete-then-insert (`DELETE FROM items_fts WHERE item_id = ?; INSERT ...`)
rather than an update, so stale nested content can never linger.

## API

### `items.list` input (extended)

`apps/api/src/modules/items/router.ts` `listInput` gains:

```ts
tagIds: z.array(z.number().int().positive()).optional(),
```

Keeping `page`, `pageSize`, `search`, `locationId`, `itemTypeId`. `ListItemsInput`
(`service.ts:44`) and `ListItemsOptions` (`repo.ts:54-60`) gain `tagIds?: number[]`.

### Response shape

`items.list` now returns:

```ts
{ items: ItemDto[]; total: number; facets: SearchFacets }
```

- `ItemDto` gains `snippet?: string` (FTS `snippet()` text, present only when `search` is set).
- `SearchFacets`:
  ```ts
  type FacetCount = { id: number; name: string; count: number }
  type TagFacet    = { id: number; name: string; color: string | null; count: number }
  type SearchFacets = {
    types:     FacetCount[]   // distinct item types with counts
    tags:      TagFacet[]     // distinct tags with counts
    locations: FacetCount[]   // the current tree level (children of selected node, or roots)
  }
  ```

### Filter semantics

- `search` (optional): when present, ranked FTS `MATCH` (joined with filters below). When
  absent, the plain `items` filter runs (unchanged). Blank/whitespace-only `search` is
  treated as absent.
- `locationId`/`itemTypeId`: **single-select, AND**, exact match.
- `tagIds`: **multi-select, OR within the dimension** (an item matching ≥1 selected tag),
  **AND across dimensions** with the other filters. Selecting several tags is "any of these",
  not "all of these".
- A facet filter **narrows** the search results (search term AND filters all apply).

### Facet-count rule

For each dimension, the count is computed over the query **excluding that dimension's own
selection** (standard faceted UX — you see what the other filters leave available, without
self-narrowing):

- `types`: `GROUP BY items.item_type_id` over items matching search + locationId + tagIds.
- `tags`: per tag, count of items matching search + locationId + itemTypeId.
- `locations`: items matching search + itemTypeId + tagIds, grouped by **the current tree
  level's nodes**. The level is `locationId`'s **children** when `locationId` is set, or the
  **root** locations when unset. Each node's count is the matching items in its **subtree**
  (node + descendants, via a recursive CTE over `locations`). The web's breadcrumb walks up
  from the selected `locationId` using the existing `locations.list`.

When `search` is present, every facet count query runs against the FTS-matched item set, so
counts reflect matched items only.

Facet lists are ordered `count DESC, name ASC` (ties broken by name).

## Web UI (`/items` enhancement)

`apps/web/src/features/items/ItemsPage.tsx`:

- **State in URL:** replace the `page` `useState` with `useSearchParams`. Read `q`,
  `locationId`, `typeId`, `tagIds[]`, `page`. Map URL `q` → tRPC `search` in one place, and
  feed the existing `trpc.items.list.useQuery({ search, locationId, itemTypeId, tagIds, page })`
  (the component reads URL `q` and passes it as the input's `search`).
- **Search box:** a controlled text input that updates the URL `q` (debounced, ~300ms), so
  typing filters the grid in place.
- **Facet sidebar:** a panel listing, with live counts:
  - **Location**: drill down one level at a time; each node shows its subtree count; a
    breadcrumb returns to ancestors. Selecting a node sets `locationId`.
  - **Type**: checkbox-free single-select chips; selecting sets `typeId`.
  - **Tags**: multi-select chips; toggling updates `tagIds[]`.
- **Snippet:** when `q` is active, render `item.snippet` under the item name on each card.
- **Reset:** a "Clear filters" control resets `q`, `locationId`, `typeId`, `tagIds[]`, `page`.
- **Pager/`total`** keep the existing behavior; `total` reflects the filtered/search count.

## Error handling

- **Malformed FTS query** (FTS5 rejects the syntax, e.g. unbalanced quotes): catch and fall
  back to a literal `LIKE '%term%'` on `items.name`, so the list never errors.
- **Blank/whitespace `search`:** treated as absent.
- **Invalid facet ids** (non-positive, or ids that don't exist): ignored (the filter simply
  selects nothing / yields a 0-count facet), not a 4xx.
- **FTS query building** uses parameterized binds exclusively — no string interpolation of
  user text into SQL (injection-safe; the master design's "Parameterized FTS `MATCH` queries").

## Security

- All `items.list` reads stay on `protectedProcedure` (any authenticated user; the catalog is
  shared). No new admin gate.
- FTS `MATCH` queries are parameterized; the literal fallback uses a bound `LIKE` parameter.

## Testing

- **Unit (`apps/api`):**
  - `reindexItem` blob composition (name/description/tags/custom-fields/type-name/location
    path), and case- + diacritic-insensitivity (e.g. `lamp` matches `Lamp`, `café` matches
    `cafe`).
  - Search query building: FTS fragment + facet-count fragments apply the join/filter rules
    above; tag OR-within-dimension; location subtree counts.
  - Snippet is only emitted when `search` is set.
- **Integration (`apps/api`):** tRPC caller on a temp SQLite: `items.list` with `search`
  returns ranked, hydrated items + `total` + `facets`; `tagIds`/`locationId`/`itemTypeId`
  narrow correctly; no-`search` path is unchanged but still returns `facets`.
- **Frontend (`apps/web`, Vitest + RTL):** search box updates URL params; facet panel renders
  counts and toggles update params; snippet renders when a term is active; reset clears params.
- **E2E (Playwright):** `admin catalogs an item end to end`-style flow extended — seed an item,
  search for it, assert it appears and a narrowing facet reduces results.

## Open decisions (resolved)

- **Param name (resolved):** the tRPC input field stays **`search`** (existing internal name);
  the web URL param is **`q`**. The `ItemsPage` component maps the URL's `q` → the tRPC
  input's `search` when it sets up the query. One name per layer; the mapping is explicit and
  lives in one place.

## Non-goals

- Custom-field facets, facets for arbitrary field values.
- `published`/draft filtering (Phase 6).
- Pagination-style search (e.g. SPLADE/BM25 external engines, a `search.query` tRPC proc).
- Highlighting beyond the single FTS `snippet()`; no multi-snippet or per-field snippet counts.
