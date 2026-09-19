# The location facet as a tree — design

**Date:** 2026-09-19 · **Related:** ADR-0009 (this decision), ADR-0002/0003/0004 (context),
`2026-09-05-phase3-search-facets-design.md` (the one-level drill-down this replaces).

*The `file:line` references were accurate when this was written. **The symbol names are the durable
anchor** — `buildWhere`, `computeFacets`, `computeLocationFacet`, `getLevelNodes`,
`listSubtreeItemIds`, `SearchFacets`, `ItemsPage` — and grepping for one is how to read a citation
that no longer lands. `CONTEXT.md` is the living glossary.*

## Problem

**The items page's location facet is a flat, horizontally-wrapping run of chips, and the numbers on
those chips are not the numbers you get.**

Two separate chip runs render `flex flex-wrap gap-2` in a 15rem column
(`ItemsPage.tsx:314`, `:331-343`): a breadcrumb rebuilt client-side from `locations.list`, then the
current level. Nothing on screen says that `garage` and `study` live under `home`; each click
**replaces** the level rather than revealing anything, and the hierarchy only manifests as chips
appearing and disappearing.

Worse, the two halves of the facet disagree. The filter is an exact match —
`eq(items.locationId, filters.locationId)` (`repo.ts:101`) — while each chip's count is a **subtree**
count, a recursive CTE over the node and all its descendants (`repo.ts:181-204`). So *home (12)*
can hand back 3 items, and the other 9 are reachable only by drilling in and reading a fresh set of
chips. With one level visible at a time the two numbers are never adjacent, which is the only reason
this has not been reported as a bug.

## Facts this design rests on

Each of these changed a decision.

- **The filter is exact and the count is recursive** — `repo.ts:101` and `repo.ts:181-204`. This is
  the whole problem; a tree puts the parent's count directly above its children's, so the two must
  be made to agree before the tree can ship.
- **`listSubtreeItemIds` already exists** — `apps/api/src/modules/locations/repo.ts:54`, a cycle-safe
  recursive CTE with `UNION` (not `UNION ALL`), currently called only by `locations.delete` and
  `deletePreview` (`locations/service.ts:175, 192`). The subtree predicate this design needs is
  already written and already trusted for the one place where getting the subtree wrong destroys
  data.
- **Facet counts are computed per request, with each dimension's own filter omitted**
  (`computeFacets`, `repo.ts:206-235`). So a count is a function of the *other* active filters and
  the search term, not a property of the data. They cannot be precomputed, and `system.rebuildFts`
  is not a home for them.
- **There is no index on `items.location_id`** — the only indexes are four unique columns
  (`0000_panoramic_human_robot.sql`), `user_settings.user_id` (`0002`),
  `item_custom_field_values.field_id`/`.item_id` (`0005`), and the FTS table. Every facet count
  therefore scans `items`.
- **The API is single-threaded and synchronous** (`better-sqlite3`), so a slow query blocks the
  whole server rather than one request. This is why the cost note below is written down at all.
- **`items.location_id` is nullable** (`packages/db/src/schema.ts:64`) — items with no location
  exist, and no facet node represents them today, so the roots' subtree counts already sum to less
  than the catalog total.
- **`LocationTree.tsx` is hardcoded to locations and always fully expanded**, and there is no
  collapsible-list primitive anywhere in `apps/web/src`: no `Tree`, `Accordion`, `Disclosure` or
  `<details>` usage. Its recursion (`LocationTree.tsx:37`) is the nearest thing to a pattern.
- **The whole page is one 430-line file** — facets, cards, grid and pagination all inline in
  `ItemsPage.tsx`. A tree, a sort control and a selection bar cannot be added to it as-is.
- **Depth is capped at 8** — `LOCATION_DEPTH_MAX`, `locations/service.ts:11`.

## Design

### 1. The facet returns the whole tree, with two counts per node

```ts
type LocationFacet = {
  id: number; name: string; parentId: number | null
  ownCount: number        // items located directly here
  subtreeCount: number    // this node plus every descendant
  unlocated?: true        // the synthetic "Unlocated" node; never has children
  children?: LocationFacet[]
}
```

`SearchFacets.locations` changes from `FacetCount[]` (the current level) to `LocationFacet[]` (the
roots of the whole tree). Every node carries counts.

**Why the whole tree and not just the open path.** The old one-level response was sufficient because
only the selected path could ever be revealed. Expansion becomes a client-side disclosure (§4), so
*any* branch can be opened on a click, and the counts for it have to already be there. Returning the
whole tree is also what makes §5 free.

**One query, not N.** Today `computeLocationFacet` runs one recursive-CTE count per returned node,
which was 3–8 queries for one level and would become one per location in the tree. The shape that
replaces it, in one scan of `items`:

```sql
WITH RECURSIVE tree(root, id) AS (
  SELECT id, id FROM locations WHERE parent_id IS NULL
  UNION
  SELECT tree.root, l.id FROM locations l JOIN tree ON l.parent_id = tree.id
)
SELECT tree.root AS rootId, tree.id AS id, <filters applied in the join>
FROM tree LEFT JOIN items ON items.location_id = tree.id AND <filters minus location>
```

Grouped by `tree.root`: the **subtree count** is the group's total, and the **own count** is the
member row where `id = root`. Assembling that into the nested shape is a reduce over rows the server
already knows how to sort and nest — `buildTree` (`locations/service.ts:79`) does the same job for
`locations.list`.

*If the `LEFT JOIN` grouping turns awkward in Drizzle, the fallback is the existing per-node CTE
loop over all nodes rather than one level — correct, more queries, ~30–60 of them at household
scale. Take it and leave a `ponytail:` comment naming the ceiling; do not reach for a cache.*

### 2. Both counts, shown only when they differ

`home 4 (12)` — own, then subtree in parentheses. A leaf reads `5`, not `5 (5)`: `ownCount ===
subtreeCount` is the common case and the parenthetical is noise there.

`ownCount` is not a partition of the parent's `subtreeCount` — `home 4 (12)` with children `5` and
`3` means 4 items sit directly in `home`. That is the point of showing both.

### 3. The filter becomes subtree-inclusive

`buildWhere` (`repo.ts:98`) replaces

```ts
if (filters.locationId != null) conds.push(eq(items.locationId, filters.locationId))
```

with a subtree predicate in the shape of `listSubtreeItemIds` — `items.location_id IN (SELECT id FROM
subtree(requested))`. Selecting *home* then yields all 12, and the nested children narrow further
instead of being the only route down.

This is ADR-0009, and it **changes what every other facet count means while a location is selected**,
because all three dimensions compose their `WHERE` through `buildWhere` (`repo.ts:98-105`): the type
and tag counts become subtree-scoped too. That is the correct and consistent outcome, and it is the
part of this work with the widest blast radius — the tests that pin the old semantics move with it
(§Testing).

### 4. Expansion is a disclosure; filtering is the name

Each row has **two hit targets**:

- a **chevron** (`<button aria-expanded>`) that opens and closes the branch — client-local state, in
  the component, not the URL, not the server;
- the **name** (`<button aria-pressed>`, accent when selected) that sets `locationId` — the filter,
  as today.

Selecting a node also opens it, so a click always reveals what it just filtered to. **The path to
the selection is always expanded**: the chevron cannot close an ancestor of the selected location.
Without that rule you can select *garage*, collapse *home*, and end up filtering the grid by a
location that is not on screen — the same invisible-state problem the batch-edit selection has to
solve, one layer up.

**Plain nested `<ul>`s and disclosure buttons, not `role="tree"`.** Full ARIA tree semantics bring
roving tabindex, arrow-key navigation and selection state that has to be modelled separately from
the filter — a real commitment for a filter sidebar that gets none of the benefit. The disclosure
pattern is the standard accessible shape for nested navigation and matches how `LocationTree.tsx`
already nests.

Expansion state resets on reload. That is accepted: it is view state, and a URL param for it would
be a fourth thing the items page encodes.

### 5. Ordering, zeros, and "All locations"

- Siblings are ordered `subtreeCount DESC, name ASC` — the current rule (`repo.ts:203`), on the count
  that means "how much is in here".
- **Zero-count nodes stay visible** (decided deliberately, to be revisited once the tree is in use).
  Under this design they cost nothing: the whole tree is already being returned.
- **"All locations" carries no count.** It is a reset control, not a node.
- **A new `Unlocated` node**, a root-level leaf filtering `location_id IS NULL`. It is what makes the
  tree account for the catalog: without it, the roots' subtree counts sum to less than the item
  total, and `4 (12)` makes that visible where flat chips hid it. It shows one number, never two.

### 6. The breadcrumb is deleted

The two chip runs collapse into the one tree. The path to the selection is now *visible as the open
branch* rather than restated as a separate row of chips, exactly as it is on the locations page.
"All locations" remains as the reset. **This is a deletion** — the client-side `parentId` walk
(`ItemsPage.tsx:99-106`) and both `flex flex-wrap` blocks go.

### 7. Two components come out of `ItemsPage.tsx`

The page is 430 lines and gains a tree, a sort control and (in the batch-edit work) a selection bar.
`ItemsPage.tsx` keeps the page; two pieces move out:

- **`features/items/FacetPanel.tsx`** — the sidebar, the mobile `Filters` toggle, and the tree. It
  owns the location tree rendering; the type and tag groups come with it unchanged.
- **`features/items/ItemCard.tsx`** — the card. This is shared with the card-location-path work and
  the selection checkbox (see `2026-09-19-catalog-card-location-path-design.md` and
  `2026-09-19-catalog-batch-edit-design.md`), both of which restructure the same markup.

Extraction is not tidying for its own sake: three features land on this file, and the alternative is
a 900-line component.

## Testing

**API (`apps/api/test/items-search.test.ts`)** — the place the semantics are actually pinned:

- selecting a location returns items in its **descendants** as well as directly in it;
- `ownCount` and `subtreeCount` are both right, including a node whose items are all in its children
  (`own 0`, `subtree N`) and a leaf (`own === subtree`);
- the `Unlocated` node returns exactly the items with `location_id IS NULL`;
- selecting a location **changes the type and tag counts** (the blast radius made explicit, so a
  future change cannot silently revert it);
- zero-count nodes are present;
- a chain at `LOCATION_DEPTH_MAX` counts correctly;
- a cyclic `parent_id` chain terminates rather than hanging (the existing `UNION` guard, re-asserted
  through the new path);
- the whole tree is returned regardless of what is selected, and the payload for a node keeps the
  same counts when the selection moves elsewhere.

**Web (`apps/web/test/searchFacets.test.tsx`)**:

- clicking a **name** sets `locationId` in the URL and expands that branch;
- clicking a **chevron** toggles the branch and does **not** touch the URL;
- the selected location's ancestors cannot be collapsed;
- `4 (12)` renders for a node whose own and subtree counts differ, and `5` alone when they are equal;
- zero-count nodes render;
- the `Unlocated` node filters;
- the breadcrumb chips are gone (the assertions pinning them are deleted, not weakened).

**Tests that move because the semantics did:** anything asserting exact-match location filtering or
the flat chip list. These are expected to change and the diff is the evidence ADR-0009 wants.

## What does NOT change

- **The type and tag facets' own rules** — `OR`-within-dimension for tags (`repo.ts:99-103`), and
  each dimension still omitting its own filter from its count.
- **The FTS index.** `items_fts.location_path` stays a space-joined root→leaf ancestor string
  (`items/fts.ts:15-38`) for search matching. The tree is a facet concern and does not touch it.
- **The URL contract** — `q`, `typeId`, `locationId`, `tagIds`, `page` keep their names and meanings
  (the *semantics* of `locationId` widen; the param does not).
- **`locations.list`** — still the tree source for the card's location path, the item form's parent
  selector and the locations page.
- **Location CRUD, depth cap, and the delete preview.**

## Open, deliberately

- **Whether zero-count nodes stay**, and whether a collapsed branch should hint at the zeros inside
  it. Revisit once the tree has been used with real data.
- **Whether `ownCount` earns its place** on every node, or only where it differs from something.
  Shipping it on all nodes is the cheap way to find out.
- **Whether the tree should be virtualised.** No, at household scale — recorded only so the next
  reader knows it was considered and did not need to be.
- **Whether a located-but-empty location should be selectable at all** (a zero-count node filters to
  nothing). Left selectable for now: the tree mirrors the data, and a node with 0 is information.
