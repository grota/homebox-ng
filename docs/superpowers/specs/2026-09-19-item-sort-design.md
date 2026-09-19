# Sorting the catalog — design

**Date:** 2026-09-19 · **Related:** `2026-09-19-location-facet-tree-design.md` (the facet panel
this control joins), `2026-09-05-phase3-search-facets-design.md` (the FTS ranking this has to
coexist with).

*The `file:line` references were accurate when this was written. **The symbol names are the durable
anchor** — `listInput`, `SearchItemsOptions`, `ITEM_FIELDS`, `buildWhere`, `SettingsPage`,
`user_settings` — and grepping for one is how to read a citation that no longer lands.*

## Problem

**The catalog is pinned to newest-first, with no control, and its ordering is not stable across
pages.**

The investigation asked whether ordering by creation date was possible. It already is: the catalog
list is ordered `desc(items.createdAt)` today (`repo.ts:284`), so what is actually being asked for
is a *configurable* ordering. That is the whole of this work — there is no ordering to introduce,
only one to expose.

Separately, and found while checking: **that ordering has no tiebreak.** Drafts and trash both order
by their date *and* `desc(items.id)` (`repo.ts:417`, `:462`); the catalog orders by
`desc(items.createdAt)` alone. Two items created in the same millisecond have no defined order
between them, so with `LIMIT`/`OFFSET` paging they can swap places between requests and be **skipped
or repeated** across a page boundary. This is reachable in practice: an unpack or a bulk publish
creates many items in a tight loop, and `createdAt` is stamped by `$defaultFn` at insert.

## Facts this design rests on

- **Ordering already exists** — `repo.ts:284`. The new default is the current behaviour.
- **There is no ordering input** — `listInput` (`items/router.ts:27-34`) has no `sort`/`orderBy`, and
  none appears in `SearchItemsOptions` (`repo.ts:77-84`).
- **The search path orders differently** — `ORDER BY rank ASC, items.created_at DESC` (`repo.ts:263`)
  on the FTS path, and the `LIKE` fallback is ordered like the plain path.
- **The columns available** — `items` carries `name`, `description`, `quantity`, `unit`, `createdAt`,
  `updatedAt` (`packages/db/src/schema.ts:57-73`); item type name and location path are a join away.
- **No index on `items.created_at`**, and none is needed: with offset paging the sort is a full scan
  regardless, and it is a single scan of a household-sized table.
- **`user_settings` is the per-user home** — `locale`, `themeMode`, `lightThemeId`, `darkThemeId`
  (`packages/db/src/schema.ts:89-96`), read through `settings.get` and written through
  `settings.update` (`apps/web/src/lib/settings/SettingsProvider.tsx:25, 29`) and edited on the
  per-user `/settings` page (`features/settings/SettingsPage.tsx`).
- **`ItemDto` already carries `createdAt` and `updatedAt`** (`items/service.ts:20-39`), so nothing
  the UI needs has to be added to the read shape.
- **Pagination is offset-based**, `PAGE_SIZE = 20` (`ItemsPage.tsx:12`, server default
  `repo.ts:293`). Ordering must therefore be server-side — a client-side sort would order one page.

## Design

### 1. An explicit sort, on the wire

`listInput` gains `sort`, and it is passed straight into the query rather than interpreted anywhere
in the client:

```ts
'relevance'            // legal on the wire; never a stored preference
'createdAt:desc'       'createdAt:asc'
'updatedAt:desc'       'updatedAt:asc'
'name:asc'             'name:desc'
```

Default `createdAt:desc` — the current behaviour, so every existing caller and test is unaffected.

**Two lists in `@homebox/shared`, not one.** `ITEM_SORTS` is what the endpoint accepts;
`ITEM_SORT_PREFERENCES` is `ITEM_SORTS` without `relevance` and is what the settings schema stores.
`relevance` has to be requestable, because the client asks for it while a search term is active —
but it must not be storable, because with no term there is no rank and a stored `relevance` would
silently mean newest-first. Validating that at the settings boundary with a "not this one" rule
would leave the two lists implied rather than named; two constants say it outright, and the default
(`DEFAULT_ITEM_SORT`) is typed as a preference so it cannot drift into being unstorable.

The sortable columns were chosen on the grounds that they are the ones a person reads a list by.
Deliberately **not** offered: `unit` and location path (nobody orders a catalog by either), a value
in a custom field (per-type, a join per sort), and `quantity` (asked over and considered and
dropped — easy to add later as one more enum member).

**Name sorting uses `COLLATE NOCASE`.** SQLite's default collation is byte order, which sorts every
uppercase name before every lowercase one — `Zebra` before `apple`. That is not a name ordering and
would read as a bug the first time it was used.

### 2. The tiebreak is fixed, and it is not optional

Every ordering ends with `items.id DESC` as the final key — **one rule, in one direction**, not a
direction that follows the primary key:

- plain path: `<sort column> <dir>, items.id DESC`;
- FTS path: `rank ASC, items.created_at DESC, items.id DESC` — relevance first, then the existing
  date order, then the deterministic key.

(An earlier draft of this spec had the tiebreak follow the primary direction
(`<sort column> <dir>, items.id <dir>`). It is always `DESC`: a tiebreak exists to be deterministic,
the direction carries no meaning, and coupling it to the primary key is one more thing to get right
for no behavioural gain.)

This closes the skip/repeat window and is worth stating plainly in the code: without it, "order by a
column whose values are not unique" plus `LIMIT`/`OFFSET` is a correctness bug, not a style
preference. It ships with this change because it is the query being edited.

### 3. The preference is per user, and lives in two places

A new `user_settings` column, `items_sort`, `NOT NULL DEFAULT 'createdAt:desc'`, alongside the
existing per-user preferences — one migration, no backfill needed since every existing row is
already correct.

Edited in **two** places, both writing the same value, which is the point:

- a `Field` on the existing per-user `/settings` page, next to locale and theme;
- an inline control on the items page, because a sort is something you change while looking at the
  list, not something you leave the list to go and change.

**Not a URL param**, unlike the filters. The filters describe *which* items you are looking at and
belong in a shareable link; the sort describes how you personally read a list, and follows you
between sessions.

### 4. Relevance while searching

The agreed behaviour, stated precisely because it is the one subtle part: **the control displays the
effective order, and picking a value writes the persisted setting.**

| State | Control shows | Stored |
|---|---|---|
| No search term | the persisted value | the persisted value |
| Search term, untouched | *Relevance* | unchanged — relevance is not stored |
| Search term, user picks a value | that value | that value, and it overrides relevance from then on |

So relevance is a *consequence of searching*, not a setting: there is one conditional default, and
the control has two sources. The visible symptom is that clearing a search term after the second row
**snaps the control back** to the stored value, because relevance was never stored. That is correct;
it is recorded here so it reads as designed rather than as a glitch on first encounter.

**A pick wins immediately, in either mode.** The control keeps a local `chosenSort` and uses it the
moment it is set, rather than reading back the stored value and waiting for the optimistic settings
write to land. Two reasons: the list reorders on the click instead of after a round trip, and the
control does not depend on the settings cache being updated to be correct. `chosenSort` starts
`null`, so the stored value (or relevance, while searching) is what an untouched page shows.

The alternative — making *Relevance* a stored enum value that falls back to newest-first when no term
is present — was rejected: it would stop relevance being the automatic default while searching, which
is the behaviour that was asked for.

## Testing

**API (`apps/api/test/items.test.ts`, `items-search.test.ts`)**:

- each `sort` value orders correctly, both directions, on the plain path and the `LIKE` fallback;
- **the tiebreak holds**: a page of items sharing `createdAt` (inserted with an identical timestamp,
  which is what a bulk create produces) sorts by `id` and pages without repeats or gaps — this is the
  regression test, and it fails against the current code when the shared timestamp spans a boundary;
- `name` sorting is case-insensitive (`Zebra` after `apple`);
- relevance still wins on the FTS path, with the tiebreak applied beneath it;
- an unknown `sort` value is rejected by the input schema, not silently defaulted;
- omitting `sort` produces exactly today's ordering.

**Web (`apps/web/test/searchFacets.test.tsx`, a new `itemSort.test.tsx`)**:

- the inline control changes the order of the grid and **persists** it (the mutation fires and the
  value survives a re-mount);
- the control reads *Relevance* while a term is present;
- picking a value while a term is present writes it and overrides relevance;
- clearing the term after that leaves the chosen value in place, and after a term that was never
  overridden, the control returns to the stored value.

## What does NOT change

- **The default ordering.** It is already `createdAt DESC`; this exposes it, it does not move it.
- **The FTS index and what gets indexed** — ordering is not a search concern.
- **`drafts.list` and `trash.list`.** They keep their own fixed orderings and their existing
  tiebreaks; their sort controls are not in scope.
- **`PAGE_SIZE` and the offset paging model.** No infinite scroll, no cursor paging.

## Open, deliberately

- **Whether `updatedAt` earns its place.** It was asked for; it is one enum member and one index-free
  scan, and it is the least obvious of the three. Keeping it.
- **Whether more columns follow** — `quantity`, then item type name, then location path. Each is one
  more enum member; none is worth the join until someone wants it.
- **Whether the inline control should be a `<select>` or a column-header affordance.** A `<select>`
  is the lazy answer and is what the per-user settings page uses for every other preference; column
  headers are the richer one and are not worth building for three columns.
- **Whether drafts and trash should share the preference.** No: their lists have their own jobs
  (publish, purge), and a shared setting would make them follow a preference tuned for the catalog.
