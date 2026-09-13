# Manual unpack, drafts pagination, and trash — design spec

**Date:** 2026-09-13 · **Branch:** `manual-unpack-and-trash` · **Decisions:** ADR-0004
(`docs/adr/0004-trash-and-recoverable-deletion.md`) · **Shared understanding confirmed 2026-09-13.**

Three deliverables that touch the same two pages. They are one branch because the drafts page
would otherwise be rewritten three times.

## Problem

**Unpack only knows how to detect.** `createItemsFromImage(ctx, source)`
(`apps/api/src/modules/unpack/service.ts:34`) takes `ctx.provider: DetectionProviderImpl` and
does detect → drop 0-area → per box: create item named from `box.label.trim() || `Draft ${i+1}``,
`saveCrop`, `insertImage`. If the detector misses something — a shelf of jars with no single
bounding box, an object the model has never seen — there is no way in. Whole feature, one
provider.

**The drafts list is unbounded.** `drafts.list` takes no input
(`apps/api/src/modules/drafts/router.ts:10`) and `listDraftItems` has no LIMIT
(`apps/api/src/modules/items/repo.ts:324-327`). Manual unpack makes bulk creation trivial, so a
page that lists everything becomes a page that lists a hundred things.

**Deleting an item is irreversible, and two paths destroy photos.** `deleteItem`
(`apps/api/src/modules/items/service.ts:158-163`) removes the row and leaks the files;
`discardDraft` (`apps/api/src/modules/drafts/service.ts:45-56`) removes the row and unlinks them
— same logical operation, two behaviours, neither recoverable. `deleteLocation`
(`apps/api/src/modules/locations/service.ts:157-193`) destroys every item inside it, photos
included. Nothing records that any of this is a guarantee, because it isn't one.

## The decision

### Manual unpack is a box source, not a second pipeline

1. **`unpack` is the pipeline; *auto* and *manual* name where the boxes came from.** Manual
   unpack supplies a `DetectionProviderImpl` for the length of one request, whose `detectBoxes`
   returns the user's rectangles with the typed name as `label`. It is never registered and
   never selectable in settings. `createItemsFromImage`, `saveCrop`, `UnpackResult` and the
   naming rule are untouched — the pipeline already parameterises naming and cropping by the box.
2. **Coordinates stay the existing contract**: pixel space, top-left origin, in the source
   image's *natural* size (`apps/api/src/modules/detection/provider.ts:1-11`). The client
   resolves the natural size on the image's `load` — as `PhotoViewer` does — and converts drawn
   coordinates into that space before sending. This is the one place a bug would be silent:
   boxes that look right on screen and crop the wrong region.
3. **Two thin endpoints, one core.** The drafts page uploads the photo *with* the rectangles —
   one multipart request (`POST /upload/unpack/manual`), so abandoning the modal leaves nothing
   orphaned. The item page already has a stored photo, so it needs no upload — a tRPC mutation
   (`unpack.manual`, `{ imageId, regions }`). Both build the manual provider and call
   `createItemsFromImage`.
4. **The item page's drafts take the source item's own type**, as the auto path from an item
   already does (`apps/api/src/modules/unpack/router.ts:20`).
5. **A blank name falls through to the pipeline's existing fallback** (`Draft 1`, `Draft 2`, …)
   rather than being refused. The fallback already exists and already runs; the modal must not
   invent a second naming rule.

### The manual unpack modal

6. **`Modal size="full"`** — the existing second geometry, not a third (ADR-0002 says a third
   would mean decomposing `Modal`). The image area, the row list and the footer are laid out
   inside it, as the photo viewer already does. A benefit worth naming: `Modal` swallows outside
   pointer-down (`apps/web/src/ui/Modal.tsx:49`), so a mis-aimed drag near the edge cannot
   dismiss the modal mid-drawing.
7. **The overlay is authored in image-pixel coordinates** and carries the *same* transform as
   the image, so a rectangle needs no per-rectangle maths. The transform comes from
   `apps/web/src/ui/zoom.ts` — pure maths over numbers with no DOM access, and fully unit-tested
   (`apps/web/test/zoom.test.ts`). This is a new pattern here: the only existing transform in the
   app is applied to a bare `<img>` (`PhotoViewer.tsx:261-271`), because the viewer has no
   overlay to carry along.
8. **Gestures, in one sentence, and stated in the modal:** drag on the photo to draw; drag a box
   to move it; drag a box's edge or corner to resize; hold **Space** and drag to move the photo;
   scroll to zoom. Click a box to select it; press **Delete** to remove it.
9. **Rectangles clamp to the image and enforce a minimum size** on both draw and resize. The
   crop is `sharp.extract`, which needs an in-bounds box; clamping in the UI means the server
   never has to reject a hand-drawn box.
10. **Each row shows the crop, the name field, a delete button, an index number and a colour**
    from a fixed hue cycle. The number is painted on its rectangle; the colour tints both. The
    number is the reliable channel, the colour the fast one.
11. **Drawing focuses the new row's name field**, so the loop is drag → type → drag → type.
12. **Submit is disabled while no rectangles exist.** Cancel, the X and Escape all close, and if
    rectangles exist they confirm first (`window.confirm`, matching
    `apps/web/src/features/drafts/DraftsPage.tsx:112`). **Escape stays "close"** — it is
    `Modal`'s behaviour and cannot be repurposed for delete.
13. **After submit the `?detected=<n>` convention is reused** — the same notice, the same
    `0`/absent distinction, for both box sources.

### The drafts page

14. **The unpack Card gains a second submit button.** Its file input and item-type `Select` are
    shared: one photo, one type, two ways to find things. The existing action is renamed
    **Auto unpack**; the new one is **Manual unpack**, and it opens the modal on the chosen
    photo. Both are disabled until a file is chosen.
15. **`drafts.list` mirrors `items.list`**: `{ page, pageSize }` in, `{ items, total }` out,
    defaults `1`/`20`, page held in the URL as `?page=` beside `?detected=`. One convention,
    not two.
16. **One shared pagination control**, extracted and used by both the items and drafts pages.
    Today the control is ten lines of inline JSX with the page size `20` hardcoded a second time
    (`apps/web/src/features/items/ItemsPage.tsx:313-323`); a third copy is where that number
    starts drifting.
17. **Selection is page-scoped and cleared when the page changes.** `selected` is already never
    pruned on refetch (`DraftsPage.tsx:36-39`) and pagination would make that a bigger,
    less visible hazard.
18. **The empty state is keyed on `total === 0`, not on the page being empty**, and an
    out-of-range `?page=` clamps to the last page rather than rendering "No drafts" under a full
    list.
19. **"Publish all N" / "Move all N to trash" are explicit actions**, not a checkbox that spans
    pages. The server already treats omitted ids as "every draft"
    (`apps/api/src/modules/drafts/service.ts:19-22`, `:35-41`) and the UI has never exposed it.
    This gives the capability without a hidden selection the user cannot review.
20. **The uncontrolled rename Input is out of scope.** Its `onBlur` flush
    (`DraftsPage.tsx:148-149`) loses a half-typed name on any refetch; pagination only makes it
    easier to hit. Fixing it here would mix an input-behaviour change into a pagination change.

### Trash

21. **`items.trashedAt`** — a nullable timestamp, not a boolean, so the trash page can say when.
    Items and drafts only; they are the same row, so this is one mechanism.
22. **Move to trash / restore / purge** are the three verbs. `discardDraft` and
    `items.delete` both become *move to trash*. Restore preserves `published`, so a thing returns
    to where it came from. Purge is per-row (*Delete forever*) and wholesale (*Empty trash*), and
    both confirm.
23. **Photo files are kept until purge**, then unlinked. This is what makes restore honest.
24. **Nothing purges automatically.** No scheduler exists, and "Empty trash" puts the timing in
    the user's hands.
25. **The trash page is `/trash`, a top-level nav item after Drafts**, paginated like the drafts
    page, listing trashed drafts and catalog items together, each labelled. Rows show name,
    thumbnail, *trashed N ago*, and Draft/Item.
26. **Deleting a single photo stays permanent but stops orphaning files.** A photo is not an
    item, so it is not trashable; `deleteImage` (`apps/api/src/modules/images/repo.ts:70`) now
    unlinks the original, the edited copy and the thumbnail, which it does not today.
27. **Deleting a location detaches its items instead of destroying them.** The items keep their
    rows and lose their `locationId`; they are re-indexed (the search blob carries the location
    path) and the prompt names the count: *"7 items will stay in your catalog with no location."*
    This closes the second photo-destroying path by removing the destruction rather than routing
    it through the trash — routing it would have required trashed items to release their
    `location_id` anyway, because `items.location_id` is `ON DELETE no action` and would block
    the location's own deletion.
28. **Trashed items keep blocking item-type deletion, and the refusal says so.** `hasItemsReference`
    (`apps/api/src/modules/itemTypes/repo.ts:151`) has no filter; adding one would delete a type
    out from under a restorable item. The message names the count in the trash
    (*"3 items in the trash use this type"*) so it does not read as a bug.
29. **The trash guard belongs at every query that reads `items`** — not just the obvious one.
    `buildWhere` (`items/repo.ts:96`) covers the catalog rows and facets, but **not**
    `listDraftItems` (`:327`), `countPublishedItemsOfType` (`itemTypes/repo.ts:143`),
    `listNonEmptyValues` (`:126`) or `computeBlob` (`items/fts.ts:50-61`). Missing the last one
    is the likeliest defect in the whole change: `rebuildFTS` (`fts.ts:132-139`) re-indexes every
    row with no filter, so an admin "rebuild search index" would quietly return every trashed
    item to search results.

## What does NOT change

- `DetectionBox`, `DetectionProviderImpl`, `createItemsFromImage`, `saveCrop`, `UnpackResult`,
  `UnpackSource` and the zero-area filter.
- The registered detection providers and the `detectionProvider` instance setting.
- The `?detected=<n>` mechanism — its blank/absent/zero distinctions are deliberate and stay.
- `items_fts`'s schema and its application-layer sync (no triggers are introduced).
- Item type, tag and user deletion. They stay hard deletes; retyping is the recovery.
- Backup and restore. The backup is a whole-file SQLite copy
  (`apps/api/src/modules/backup/service.ts:24-44`), so trash rides along in both directions with
  no change — including resurrecting trashed items when an older snapshot is restored. The admin
  preview's item count also counts them; left as is.
- The manual-unpack modal does not zoom beyond `zoom.ts`'s fit↔1:1 range, and it has no rotation,
  no crop and no free-form drawing.

## Open, deliberately

- The trash has no retention policy and no badge in the nav. If either is wanted, it is a later,
  smaller change.
- Manual unpack writes no description, no quantity and no location — the same shape auto unpack
  produces, because it is the same pipeline.
