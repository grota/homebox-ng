# ADR-0004: Trash — deleting an item is recoverable; purging is not

**Status:** Accepted (2026-09-13). Supersedes the "no soft delete" ruling in
`docs/superpowers/plans/2026-09-11-bulk-draft-discard.md:730`.

## Context

`docs/superpowers/plans/2026-09-11-bulk-draft-discard.md:730` recorded the opposite of this
decision, deliberately: *"A bulk discard cannot be undone. The confirmation names the count and
nothing else; no undo, no soft delete."* That was defensible when drafts were rare. Manual
unpack changes the arithmetic — it can create a dozen drafts in one gesture, so a dozen can be
discarded in one gesture too, and the cost of a mistake went up while its reversibility stayed
at zero.

Three things were wrong beyond "there is no undo", and each was invisible from the outside:

1. **Two paths destroy photos, and they disagree about files.** `discardDraft`
   (`apps/api/src/modules/drafts/service.ts:45-56`) deletes the row *and* best-effort unlinks
   `originalPath`, `editedPath` and `thumbPath`. `deleteItem`
   (`apps/api/src/modules/items/service.ts:158-163`) deletes the same row and leaves all three
   files on disk forever. The item page's prompt — *`Delete "X" and its photos?`*
   (`apps/web/src/features/items/ItemDetail.tsx:85`) — describes behaviour the item path does
   not have. `deleteImage` (`apps/api/src/modules/images/repo.ts:70`) orphans files the same way.
2. **Deleting a location destroys every item inside it.** `deleteLocation`
   (`apps/api/src/modules/locations/service.ts:157-193`) deletes the subtree's items, their
   images and their files. It is a second, quieter way to lose a photo, and no prompt framed it
   as such.
3. **Nothing recorded the guarantee.** Whether an item's photos could survive a mis-click was
   an emergent property of which function you happened to call.

Item types and tags are recoverable by retyping. A photo is not.

## Decision

**An item is never destroyed by a delete. It moves to the trash, and only a purge destroys it.**
The guarantee, and the sentence a reader of the code should be able to check:

> Nothing destroys an item's photos except purging the trash.

1. **Items and drafts are the only trashable things.** Same row, same table, told apart by
   `published` — so this is one mechanism, not two. Locations, item types and tags stay
   hard-deleted; their loss is a retyping, not a photo.
2. **A `trashedAt` timestamp, not a boolean.** It records *when*, which the trash page shows and
   a boolean cannot. A trashed item is excluded from the catalog (`items/repo.ts:96`), from
   `listDraftItems` (`items/repo.ts:327`), and from `countPublishedItemsOfType` — and from the
   search index, which is the part that is easy to get wrong (see Consequences).
3. **Move to trash replaces discard.** Both `drafts.discard`/`discardAll` and the item page's
   delete route to it. The recoverable action takes the recoverable word.
4. **Restore returns a thing where it came from**, by preserving `published`: a trashed draft to
   the drafts page, a trashed catalog item to the catalog. Nothing else is restored, because
   nothing else was taken — an item that had no location comes back with none.
5. **Purge is per-row (`Delete forever`) and wholesale (`Empty trash`), and both confirm.** It
   is the only place that unlinks files.
6. **Deleting a location detaches its items instead of destroying them.** The items keep their
   rows and lose their `locationId`; the prompt says so and names the count
   (*"7 items will stay in your catalog with no location"*). This closes the second photo-
   destroying path by removing the destruction, not by routing it through the trash — which
   would have required trashed items to release their `location_id` anyway, since
   `items.location_id` is `ON DELETE no action` and would block the location's own deletion.
7. **Deleting a single photo stays permanent and stops orphaning its files.** A photo is not an
   item, so it is not trashable; but `deleteImage` now unlinks what it used to leave behind.
   Same for `deleteItem`'s files — they are kept until purge, which is the point.

## Consequences

### Alternatives rejected

- **Keep the hard delete and warn harder.** A more emphatic dialog does not make an irreversible
  action reversible; it makes the user read a sentence before losing something anyway. And
  bulk discard already names the count — the warning was as good as it could get.
- **A boolean `trashed` instead of `trashedAt`.** Simpler, and loses the only information that
  makes a trash feel safe rather than merely second list. The timestamp is also what a future
  retention policy would need, should one be wanted.
- **Trash the items when a location is deleted** (the shape first proposed). It creates the
  interaction this design otherwise avoids: trashed items holding a `location_id` block the
  location's own delete, so they must also be detached, and the user then has to discover that
  deleting a shelf sent their things to the bin. Detaching alone closes the hole with less code
  and a clearer prompt.
- **Extend trash to locations, item types and tags.** Four more `trashedAt` columns and a guard
  in every query that touches them, to protect data that is cheap to retype.
- **Auto-purge after N days.** Needs a scheduler this app does not have; "Empty trash" puts the
  timing in the user's hands, which is the whole point of the feature.

### Accepted costs

- **A flag threaded through the search index, in about six places.** `items_fts` is a separate
  table kept in sync by application code — there are no SQL triggers. Adding the predicate to
  `buildWhere` (`items/repo.ts:96`) covers the row and facet queries, but **not**
  `listDraftItems`, `countPublishedItemsOfType`, `listNonEmptyValues`, or `computeBlob`
  (`apps/api/src/modules/items/fts.ts:50-61`). Miss the last one and `rebuildFTS`
  (`fts.ts:132-139`), the admin's "rebuild search index" repair, re-indexes **every row with no
  filter** and silently returns every trashed item to search results. This is the single most
  likely defect in the change.
- **Trashed items keep blocking item-type deletion.** `hasItemsReference`
  (`apps/api/src/modules/itemTypes/repo.ts:151`) has no filter, so a type used only by trashed
  items cannot be deleted. Left that way deliberately: allowing it would delete a type out from
  under an item that can still be restored, and `items.item_type_id` is `ON DELETE no action`.
  The refusal must name the reason — a count of items *in the trash* — or it reads as a bug.
- **Disk holds a second copy of what was deleted** until the trash is emptied. Bounded by the
  user, who is told the trash exists.
- **Restoring from an older backup resurrects trashed items.** The backup is a whole-file SQLite
  copy (`apps/api/src/modules/backup/service.ts:24-44`), so trash rides along in both directions
  with no change needed — including back in time. The admin preview's `itemCount`
  (`service.ts:81-82`) also counts trashed items; left as is.
- **Deleting a location is no longer a way to delete its contents.** A real capability is given
  up: "remove this shelf and everything on it" becomes two steps. Judged worth it because the
  one-step version was the app's least-visible way to lose a photo.

### When to revisit

If locations, item types or tags are asked for a trash, stop adding `trashedAt` columns one at a
time and generalise — a single soft-delete convention the schema applies uniformly. Three
columns is a pattern; a fourth wants a design.

## Related

- `CONTEXT.md` — **trash**, **move to trash**, **restore**, **purge**; **discard** is demoted to
  an _Avoid_.
- `docs/superpowers/plans/2026-09-11-bulk-draft-discard.md:730` — the ruling this supersedes.
- ADR-0003 (`0003-non-destructive-field-edits.md`) — the same instinct one layer up: destruction
  is enumerated and acknowledged, never incidental.
