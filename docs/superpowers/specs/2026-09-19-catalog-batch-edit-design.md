# Batch edit on the catalog — design

**Date:** 2026-09-19 · **Related:** ADR-0010 (the selection and the count pin), ADR-0008 (the
`Popover` primitive), ADR-0009 (subtree-inclusive location filtering, which the criteria modal's
location clause follows), ADR-0003 (`acknowledgedValueCount`, the mechanism this generalises),
ADR-0004 (trash — what bulk edits do not have).
**Supersedes for the catalog:** the drafts page's page-scoped selection rationale
(`2026-09-11-photo-viewer-and-bulk-discard-design.md`).

*The `file:line` references were accurate when this was written. **The symbol names are the durable
anchor** — `buildWhere`, `resolveSelection`, `selectionSummary`, `bulkUpdate`, `DraftsPage`,
`Modal`, `Popover`, `replaceFieldValues`, `reindexItem` — and grepping for one is how to read a
citation that no longer lands.*

## Problem

**The items page can only show items. Acting on more than one of them is not possible at all — and
the two things that make it possible, "which items" and "what to do", are both unbounded.**

There is no selection on the items page today: no checkbox, no selection state, no bulk action
(`ItemsPage.tsx`, whole file). The only selection in the app is the drafts list, and it made two
deliberate choices that do not transfer: it is **page-scoped** — cleared on page change, with the
rationale "Selection is page-scoped… would be the same hazard with more reach"
(`DraftsPage.tsx:72-76`) — and whole-dataset actions are a **separate verb pair** sending `{}`, where
an omitted or empty id array means *every* draft (`drafts/service.ts:22-25, 42-48`).

The catalog needs the opposite: a bulk retag or relocation of 300 items is the task, and doing it
twenty rows at a time is not the task. So "select all" has to mean everything the current search and
filters match, and the selection has to outlive the view it was made in.

That is where the real problem is. A selection made from a view you then navigate away from can hold
items that have changed since you looked at them, and the counts a panel shows you are stale by the
time you press the button. ADR-0003 solved exactly this for a single field's values, with
`acknowledgedValueCount`, and closed by instructing that bulk value editing should **generalise**
that mechanism rather than add another flag to it. A catalog-wide selection is a superset of that
case — more items, more properties, and a write rather than a publish — so the acknowledgment has to
be at least as strong, and it is the part of this feature that cannot be left implicit.

## Facts this design rests on

Each of these changed a decision.

- **There is no bulk mutation for items at all** — only `create`/`update`/`trash` per item
  (`items/router.ts:39-43`). The only batch DB helper in the codebase is `clearItemLocations`
  (`items/repo.ts:444-447`), used internally by location delete.
- **`tags.assign` is replace-semantics** — `{itemId, tagIds}` deletes every row for that item and
  re-inserts (`tags/repo.ts:59-71`). Reusing it per item for a bulk edit would be N transactions, and
  exposing it as a "here is the resulting set" panel would silently delete every tag the user did not
  touch.
- **Tags upsert by name** — `tags.create` (`tags/router.ts:24-32`) creates or returns an existing
  tag, so creating a tag during a bulk edit needs no new procedure.
- **`item_custom_field_values` has no unique constraint on `(item_id, field_id)`** — only separate
  indexes (`packages/db/src/schema.ts:75-84`, migration `0005`). An `ON CONFLICT` upsert is therefore
  not available; setting one field across a selection is delete-then-insert, mirroring
  `replaceFieldValues` (`items/repo.ts:475-480`).
- **`reindexItem` is per item, and every existing bulk path already loops it** — `tags/service.ts:64`
  and `:75`, `locations/service.ts:197`, `itemTypes/service.ts:249`, and `fts.ts:113/131/146`, all
  inside a transaction. There is no set-based reindex, and inventing one is not required.
- **`items.update`'s `fieldValues` is a full replacement** (`items/service.ts:153-155`). A bulk
  *set one field* is deliberately not that: it touches one field and leaves the item's other values
  alone.
- **Every facet count and the item list compose through one predicate** — `buildWhere`
  (`items/repo.ts:98`), which always ANDs `published = true` and `trashedAt IS NULL`. There is one
  place where "is a catalog item" is decided, and it is this one.
- **`items.list` already returns `total`** — the count of everything matching, not the page
  (`items/repo.ts:77-84`). The "select all N matching" label needs no new query.
- **`ItemDto` carries `createdAt`** (`items/service.ts:20-39`), so the selection UI and the date
  criteria have the field they need.
- **No `@radix-ui/react-popover`, and `Modal` has exactly two geometries** with ADR-0002 explicitly
  against a third. There is no anchored-panel pattern in the app; `Tooltip.tsx` is CSS-only and
  `pointer-events-none`.
- **The card is one `<Link>` wrapping everything** (`ItemsPage.tsx:384`), and the drafts page solved
  the checkbox-inside-a-card problem by putting it in a footer *outside* the link
  (`DraftsPage.tsx:193-216`).
- **Tests pin the drafts behaviour** and are the pattern to follow: `apps/web/test/drafts.test.tsx`
  (`:274` the `{}` payload, `:377` the count from selection, `:253` page change clears selection).

## Design

### 1. The selection is a set of catalog item ids

```ts
const [selected, setSelected] = useState<Set<number>>(new Set())
```

Component-local, in the items page, beside the filters. It is **independent of the view**: changing
the search term, any filter, or the page does not touch it. It is **lost on reload** and on leaving
the page, and it is **not** encoded in the URL — an id list is not a link, and a URL that grows with
a selection is a URL that breaks.

This is the deliberate reversal of the drafts page's page-scoped decision (ADR-0010), and the reason
it is safe to reverse is §7: the counts are pinned, and the write resolves through the catalog
predicate. The drafts page keeps its behaviour until it adopts this model (see Follow-ups).

### 2. Four controls, and one of them carries a count

| Control | Behaviour |
|---|---|
| **Select all N matching** | resolves everything the current search and filters match; merges into the selection |
| **Deselect all** | empties it |
| **Add to selection…** | opens the criteria popover in `add` mode |
| **Remove from selection…** | opens the same popover in `remove` mode |

The label says **"Select all 47 matching"**, not "Select all": `N` is `total` from the current
`items.list` response, already on the wire. It means the filtered set, which is what makes "all items,
not just the page" useful; the whole catalog remains reachable by clearing the filters first.

### 3. The criteria popover: three sections, AND-ed

One component, `mode: 'add' | 'remove'`, opened from either button — the two operations are the same
query with the opposite sign, and building them twice would be two places to fix a bug.

- **Tags** — the existing tags (`tags.list`), multi-select. Union within the dimension, matching
  `buildWhere`'s `tagIds` rule (`items/repo.ts:99-103`), so a criteria clause and a sidebar filter
  mean the same thing.
- **Locations** — the facet tree from `2026-09-19-location-facet-tree-design.md`, **multi-select**:
  this is a query builder, not the sidebar, so it is not held to the sidebar's single-select rule.
  Subtree-inclusive per ADR-0009.
- **Created between** — a from/to range, **bounded by the catalog's real minimum and maximum
  creation date** so the picker cannot offer an empty result. Two native `<input type="date">`.
  The bounds come from one small read, `items.createdAtRange` → `{min, max}`; the requirement was
  that only existing dates are offered, and a bounded range is the usable form of that. A literal
  list of every distinct date was rejected: it would be hundreds of entries, mostly singletons.

The three sections are **AND-ed**. Applying is disabled when nothing resolves, and the count is
**live** — "Adds 12 items" / "Removes 12 items" — debounced, with a spinner-free inline label. The
count is worth its round trip: it is the only way to know a clause does what you meant before it
mutates the selection.

### 4. One read backs all of it

```ts
items.resolveSelection({
  search?, itemTypeId?, tagIds?, locationIds?, createdFrom?, createdTo?
}) → { ids: number[], total: number }
```

Three callers: **select all matching** (the current list filters), and both criteria modes. The
input is a **superset** of `listInput` — `locationIds` plural and the date range — because a criteria
clause is a query, while the sidebar's `locationId` stays single and singular. Both route through
`buildWhere`, so `published AND not trashed` applies to every resolved id and the count and the ids
can never disagree.

`total` is returned alongside `ids` so the modal can say *"Adds 12 items"* without loading twelve
ids it is not going to use — the client computes the union count as `ids.length`, and the two are
the same number from the same query.

**Ceiling, recorded:** the resolved ids travel to the client and back on the mutation (§7). A few
thousand integers is tens of kilobytes, which is nothing; a hundred thousand would not be. Household
scale is the design point, and a predicate-based mutation is the known upgrade if that ever changes.

### 5. The mutate popover: distributions, not "Mixed"

The second popover, opened from the action bar once the selection is non-empty. **It shows what will
change, not just that things differ** — which is also how the count the pin needs becomes free.

It is fed by one read, `items.selectionSummary({ ids })`, returning the resolved total and, per
property, the distribution of current values across the selection:

```
Location      garage ×8 · study ×3 · (none) ×1             [ Set all to ▾ ]   [ Clear ]
Tags          fragile ×12 · heavy ×4                       [ Add ▾ ]  [ Remove ▾ ]
              + create a tag…
Item type     ← only when every selected item shares one type
  Size        large ×9 · small ×3 · (empty) ×5             [ Set all to ▾ ]   [ Clear ]
```

Per property:

- **Location** — a single value or *Clear* (sets `locationId` to NULL). Setting overrides every
  selected item's location, as requested.
- **Tags** — the union across the selection with counts, as a **tri-state per tag**: *add to all*,
  *remove from all*, or untouched. Plus creating a tag that does not exist yet (`tags.create` upserts
  by name, so no new procedure). **Not** presented as "the resulting set of tags": that is
  `tags.assign`'s replace-semantics, and a panel shaped that way would delete every tag the user did
  not interact with — the modal's job is to say what it is adding and removing, not to restate the
  item.
- **Custom fields** — shown **only when every selected item shares one type**; fields belong to
  exactly one type (`item_type_fields.itemTypeId`), so a selection spanning two types has an empty
  field intersection. Otherwise the section is absent and says why (*"selection spans 3 types — no
  shared fields"*), rather than silently offering one type's fields to another's items. The input
  matches the field's `fieldType`, like the item form's.
- **Not offered:** `name`, `description` (nothing sensible to set across items), `quantity` and
  `unit` (not asked for; one enum member each if ever wanted), and **`itemTypeId`** — changing the
  type of a selection strands every custom-field value whose field belongs to the old type, with no
  next step to offer. That is precisely what ADR-0003 exists to prevent, and it would need its own
  destructive-acknowledgment design (ADR-0010, *when to revisit*).

Each row states its own effect: **"changes 9 of 12"**. That number is the count of items whose
current value differs from the new one, computed from the distribution rather than a second query —
and it is exactly the number §7 pins.

**Refinement, from building it: the panel does not compute that number — it displays the one the
server returns.** `selectionSummary` takes the *pending* edit alongside the ids and returns
`changes`, keyed per property (`location`, `tags.add`, `tags.remove`, `field:<id>`), so the panel's
live count is a server read keyed on what the user has composed rather than arithmetic duplicated in
the component. Two reasons it is not client-side:

- **A tag count is not derivable from the distributions.** Adding two tags to a selection where one
  item already carries both is *not* the sum of the per-tag marginals, so the number the panel would
  have had to compute is the one number the distributions do not contain.
- **The count on the button and the count the pin checks must be one implementation.** If the panel
  derived its own and the server re-derived a different one, the pin would fire on every edit —
  a guard that always refuses is worse than no guard, because it would be switched off.

The cost is a round trip as the user composes the edit (a tag toggled, a location chosen), which is
one request per discrete gesture and not per keystroke.

### 6. Applying is one transaction

```ts
items.bulkUpdate({
  ids: number[],                     // .min(1) — an empty list is rejected, never "everything"
  location?: { set: number | null },
  tags?: { add?: number[], remove?: number[] },
  fieldValues?: { fieldId: number, value: string | null }[],
  acknowledgedItemCount: number,
  acknowledgedOverwriteCounts?: Record<string, number>,
}) → { updated: number }
```

- **Explicit, non-empty ids.** This deliberately does **not** inherit the drafts convention where an
  omitted or empty array means everything (`drafts/service.ts:22-25`). A checkbox UI can produce an
  empty array, and a verb that reads that as "the whole catalog" is one click from rewriting
  everything. A whole-catalog operation, if ever wanted, gets its own named verb.
- **Set-based SQL, not a per-item loop**: one `UPDATE items SET location_id = ?` over the id set; tag
  adds as `INSERT OR IGNORE INTO item_tags`, removes as a `DELETE` over the id set; field values as
  delete-then-insert per field (§Facts: no unique constraint to upsert against).
- **Then reindex, per item, inside the same transaction** — `reindexItem` for every affected id, which
  is what every existing bulk path already does. A bulk location change that did not reindex would
  leave `items_fts.location_path` stale and search would miss the new path.
  *`ponytail:` the reindex is per item; at household scale it is a loop of a few thousand upserts in
  one transaction. If a single edit ever touches enough items to matter, the fix is a set-based
  reindex, not a smaller transaction.*
- **Returns `{ updated }`**, the number actually written, so the UI can report it and so a test can
  assert it against `acknowledgedItemCount`.

### 7. The count pin — the part ADR-0003 asked for

The modal displays counts; the request **carries those same counts**; the server **re-derives them
immediately before writing** and refuses with `CONFLICT` if either moved. Two numbers, not one:

- `acknowledgedItemCount` — the resolved target size (*"12 items will change"*);
- `acknowledgedOverwriteCounts` — per property, how many items' values are being replaced
  (*"9 of 12"*).

Ordering follows ADR-0003 §4 exactly: **the comparison precedes the transaction**, so a refusal
writes nothing, and the transaction re-derives what it writes for itself.

The two refusal cases are different and both matter:

- **Something changed while the modal was open** (an item trashed on another device, an unpack
  publishing into the filter) → `CONFLICT`, and the user reopens the modal and sees the new numbers.
- **Something was already out of the catalog when the modal opened** — because §4 resolves through
  `buildWhere`, it was never counted and never shown. So it is neither written nor "skipped": it
  simply is not in the 12. That is why a silent skip is not a separate behaviour, and why adding one
  would contradict the pin: the count would move without anyone being told.

### 8. An empty selection is refused, silently and visibly

`ids` is `.min(1)` in the schema, so an empty selection cannot reach the mutation at all — the action
bar's Apply is disabled at zero, and the server rejects it if it is reached anyway. Both, because the
disabled button is a UI convention and the schema is the contract.

### 9. The card carries a checkbox, outside its link

The catalog card becomes the drafts card's shape: the photo and the text stay inside the card's
single `<Link>`, and the checkbox moves to a **footer outside it** (`DraftsPage.tsx:193-216` is the
precedent). A checkbox inside a link is nested-interactive — invalid HTML, and it behaves
differently in every browser.

This restructures the same markup as `2026-09-19-catalog-card-location-path-design.md`; whichever of
the two lands second does the restructuring. Both are served by extracting `ItemCard.tsx` from
`ItemsPage.tsx` first.

Checkboxes are **always visible**, like the drafts page — there is no separate "select mode" to enter
and forget you are in.

### 10. The action bar, and finding a selection you can no longer see

A sticky bar appears once the selection is non-empty. It carries the count and the controls, and it
is the answer to the question the id-set model creates — *where did my selection go?*:

- **"12 selected"**, always visible while non-zero, whether or not those items are on screen.
- **"Selected only"** — filters the grid to the selection, so a selection hidden behind a filter
  change becomes visible. Needs one addition to `listInput`: an optional `ids?: number[]`, which
  also makes the selection pageable like anything else.
- **Clear** — empties it.
- **Apply to selection…** — opens the mutate popover.

**While "Selected only" is on, the facet panel is hidden.** Its counts describe the catalog under the
current filters; the grid would describe the selection. Two panels saying different things about the
same list is worse than one panel missing. The mobile `Filters` toggle is hidden with it.

The selection bar is separate from the mobile facet overlay (`ItemsPage.tsx:237-239`, which is
`fixed inset-0` below `lg`) so that entering the selection view does not cover the controls that act
on it.

### 11. The two popovers

Built on the new `Popover` primitive (ADR-0008): anchored beside the button that opened it on a
desktop viewport, full-screen below `md`. Radix supplies dismissal, Escape, focus trap and restore;
the responsive switch is ours.

Both are forms, so **neither closes on apply failure** — a `CONFLICT` from the pin lands in the
popover with the new numbers, not behind a dismissed overlay.

## Testing

**API (`apps/api/test/items.test.ts`, a new `bulk.test.ts`)**:

- `resolveSelection` matches `buildWhere` exactly: search, type, tags (union), multiple locations
  (subtree), and the created range; and **never returns drafts or trashed items**;
- `total` and `ids.length` agree in every case;
- `createdAtRange` reflects the real data, and an empty catalog returns no range rather than a
  fabricated one;
- `selectionSummary` distributions sum to the resolved total, per property;
- `bulkUpdate` with `location.set` moves exactly the given ids and **leaves other items' locations
  alone**;
- `bulkUpdate` with `tags.add` does not disturb tags that were not named (the replace-semantics trap,
  asserted directly);
- `bulkUpdate` with `fieldValues` sets one field and **does not clear the item's other field values**;
- **an empty `ids` array is rejected**, and it does not touch a single row;
- ids that are drafts or trashed are **not written**, and the returned `updated` reflects that;
- **the pin refuses**: changing an item between the summary read and the mutation returns `CONFLICT`
  and **writes nothing** (assert the rows are unchanged, not just the error);
- the pin refuses when the target count moved and when an overwrite count moved, separately;
- **FTS follows the write**: after a bulk location change, searching the new location path finds the
  items (a stale-index bug is invisible without this);
- a bulk edit over a few thousand items completes in one transaction and reports the right count.

**Web (`apps/web/test/batchEdit.test.tsx`, extensions to `searchFacets.test.tsx`)**:

- the four controls behave as specified, and the select-all label carries the matching count;
- **the selection survives a filter change, a search and a page change** — the whole point, asserted
  directly, in contrast to `drafts.test.tsx:253`;
- the checkbox is reachable by keyboard and is not inside the link (the card's click-to-navigate test
  still passes);
- the criteria popover's live count, the disabled Apply at zero, and `add`/`remove` modes from the
  same component;
- the date range is bounded by the real min/max;
- the mutate popover shows distributions and per-row "changes N of M";
- the custom-field section is **absent** for a mixed-type selection and present for a single-type one;
- applying reports the changed count and clears the selection;
- a `CONFLICT` keeps the popover open and shows the new numbers;
- "Selected only" hides the facet panel;
- an empty selection cannot reach the mutation.

**i18n**: every new string in `apps/web/src/locales/en/translation.json`, including the two count
strings and the mixed-type explanation.

## What does NOT change

- **`items.create` / `items.update` / `items.trash`.** The single-item path is untouched; a bulk edit
  is not a loop over it.
- **`tags.assign` and its replace-semantics.** Still the item form's contract, still correct for
  editing one item's tags as a set.
- **The drafts and trash pages.** They keep their page-scoped selection and their `{}`-means-all
  verbs until the follow-up below.
- **The trash model.** Bulk edit does not become a bulk delete; trashing stays single-item, and
  ADR-0004's recoverable deletion is not extended here.
- **`PAGE_SIZE`, offset paging, and the facet semantics** (the last is ADR-0009's business, not
  this spec's).

## Open, deliberately

- **Whether the four selection controls stay four buttons**, or collapse into a menu once the toolbar
  is crowded on a phone. Four is what was asked for and what fits the desktop bar; the mobile
  arrangement is the thing to watch.
- **No undo.** A bulk overwrite is not reversible; the count in the modal and the pin behind it make
  it deliberate, not reversible. ADR-0010 records this as an accepted cost, and a change log is the
  thing that would change it.
- **Whether `selectionSummary` distributions should be capped** for a very large selection (the top
  N values plus "and 47 more"). At household scale a selection's distinct locations, tags and field
  values are all small; the ceiling is recorded rather than guarded.
- **Whether the criteria modal should offer a criteria *preview*** of the matching items, not just a
  count. The count is the cheap version and answers "is this clause right?"; a preview is another
  grid.
- **Whether the action bar should offer "invert selection".** Not asked for; it is one line if the
  four controls ever feel incomplete.

## Follow-ups this creates

1. **The drafts page adopts the shared selection** — replaces its page-scoped `Set` and its
   `setSelected(new Set())` on page change (`DraftsPage.tsx:76`) and collapses the separate "Every
   draft:" row (`:154-169`) into the same four controls. A deletion, deliberately deferred until the
   catalog version has been used. **File as an issue; do not do it here.**
2. **Drafts and trash cards gain the location path** — the same gap the catalog card has, cheap once
   `ItemCard.tsx` exists (`2026-09-19-catalog-card-location-path-design.md`).
3. **Whether bulk edit reaches the trash page** (restore/purge in bulk). Out of scope; `trash.purgeAll`
   already covers the whole-trash case.
