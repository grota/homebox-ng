# ADR-0009: The location facet is a tree of own and subtree counts, and a location filter is subtree-inclusive

**Status:** Accepted (2026-09-19).

## Context

Phase 3 built the location facet as a **one-level-at-a-time drill-down**: the sidebar shows the
children of the selected location (or the roots), and a breadcrumb walks back up. It specified two
things that could not both be right, and nothing exposed the disagreement:

- **the filter is an exact match** — `buildWhere` pushes `eq(items.locationId, filters.locationId)`
  (`apps/api/src/modules/items/repo.ts:101`);
- **each node's count is a subtree count** — a recursive CTE over that node and all its descendants
  (`repo.ts:181-204`).

So a chip reading *home (12)* could hand back 3 items, with the other 9 living in `home/garage` and
`home/study` — reachable only by drilling in. With one level on screen at a time, no one could see
the two numbers side by side.

The request to render the facet as a **tree** — children nested inside parents, parents stacked
vertically — removes that cover. In a tree, *home (12)* sits directly above *garage (5)* and
*study (3)*, and 5 + 3 ≠ 12. The mismatch becomes visible nonsense, and it has to be resolved
before the tree can ship.

Three facts constrain the resolution. `listSubtreeItemIds` (a cycle-safe recursive CTE) **already
exists** — `apps/api/src/modules/locations/repo.ts:54` — and is used today only by location delete;
it is the subtree predicate the filter would need. Facet counts are **computed per request with
each dimension's own filter omitted** (`computeFacets`, `repo.ts:206-235`), so they are a property
of the current query, not of the data — they cannot be precomputed or cached. And
`items.location_id` is **nullable**, so items with no location exist and belong somewhere in the
tree.

## Decision

**The location facet becomes a tree, every node carries both counts, and a location filter selects
the whole subtree.**

1. **Two counts per node.** `ownCount` is items located directly at the node; `subtreeCount` is the
   node plus every descendant. Both are shown when they differ — `home 4 (12)` — and the second is
   omitted when they are equal, so a leaf reads `5` and not `5 (5)`.
2. **The filter is subtree-inclusive.** `buildWhere` uses the subtree predicate
   (`listSubtreeItemIds`-shaped) in place of `eq(items.locationId, ...)`. Selecting *home* yields
   all 12; the nested children are a *narrow further* affordance, not the only route down.
3. **The facet returns the whole tree, not one level.** Expansion is a client-side disclosure
   (children can be opened without changing the filter), so any node can be revealed and the server
   must supply counts for all of them.
4. **Unlocated items get a node.** A root-level leaf filtering `location_id IS NULL`, so the tree
   accounts for the catalog.
5. **"All locations" carries no count.** It is a reset, not a facet node; a number there invites a
   sum that will not add up.

## Consequences

### Alternatives rejected

- **Exact-match counts instead of a subtree filter.** Honest per node, but a root that holds only
  sub-locations reads `0` — the three roots in a typical household would all read 0 and the tree
  would look empty until opened. This fails the case the tree exists for.
- **Keep the exact filter and label the counts as subtree counts.** Makes the numbers true and the
  *result set* surprising instead: you click a node promising 12 and get 3. A label does not fix a
  filter.
- **Precompute the counts, e.g. alongside `system.rebuildFts`.** Impossible in principle rather than
  merely expensive: each dimension's count omits its own filter, so every count is a function of the
  other active filters and the search term. There is nothing filter-independent to store.
- **Subtree counts only while drilling, exact counts in the tree.** One number meaning two things
  depending on how you reached it is worse than either.

### Accepted costs

- **A documented Phase 3 decision is reversed.** The Phase 3 spec deliberately specified exact-match
  filtering; this ADR is the record that it was wrong once a tree made the two numbers adjacent.
- **Every facet count changes meaning when a location is selected.** Types and tags will now be
  counted within the subtree. That is the correct and consistent outcome — all three dimensions
  compose through `buildWhere` — but it is a behaviour change, and the tests that pin the old
  semantics move with it.
- **The tree costs more counting than one level did.** Counts are per node over the whole tree
  instead of per node over one level, and the precompute escape hatch is closed. The mitigation is
  one query instead of N: a single recursive CTE over all locations, `LEFT JOIN`ed to the filtered
  items and grouped by node, which is *less* code than the current per-node loop rather than more.
- **A node's count is not a partition of its parent's.** `home 4 (12)` with children `5` and `3`
  means 4 items sit directly in home; a reader who assumes the parenthetical is a sum of children
  will be briefly wrong.
- **`ownCount` needs a place to live in the facet DTO.** The facet payload grows by one integer per
  node, and the client-side `SearchFacets` type changes shape from a flat list to a tree.

### When to revisit

If a "directly in this location only" filter is ever wanted, it becomes an **explicit second
control** — never a silent change to what the existing one means. Two meanings behind one chip is
the bug this ADR is fixing, not a pattern to repeat.

## Related

- Phase 3 spec: `docs/superpowers/specs/2026-09-05-phase3-search-facets-design.md` (§§ stating the
  one-level drill-down and the exact-match filter this supersedes).
- ADR-0006 (`0006-backup-history-lives-beside-its-archives.md`) — the `system.rebuildFts` surface
  this ADR declines to extend.
- Design spec: `docs/superpowers/specs/2026-09-19-location-facet-tree-design.md`.
