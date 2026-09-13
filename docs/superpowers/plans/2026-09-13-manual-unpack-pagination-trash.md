# Manual unpack, drafts pagination, and trash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create drafts by drawing boxes on a photo (manual unpack) alongside detection (auto unpack); page the drafts list; and make deleting an item recoverable, with purging as the only operation that destroys a photo.

**Architecture:** Manual unpack is a `DetectionProviderImpl` built for one request — its `detectBoxes` returns the user's rectangles, with the typed name as the box `label` — so `createItemsFromImage`, `saveCrop`, `UnpackResult` and the `Draft N` naming rule are untouched. The web modal draws an SVG overlay authored in image-pixel coordinates and gives it the same transform as the image, reusing `ui/zoom.ts` (pure maths, no DOM, unit-tested). `drafts.list` gains the `{ page, pageSize }` → `{ items, total }` shape `items.list` already has. Trash is one nullable `items.trashedAt`, guarded at *every* query that reads `items` — including the FTS blob, which is the part that is easy to miss.

**Spec:** `docs/superpowers/specs/2026-09-13-manual-unpack-pagination-trash-design.md`
**Decision record:** `docs/adr/0004-trash-and-recoverable-deletion.md`

## Global Constraints

- Build order `shared → db → api → web`. `packages/db` is consumed via its built `dist/`, so a schema change requires `pnpm --filter @homebox/db build` before the API sees it.
- The manual provider is **never registered** and never appears in `detectionProvider` settings. It exists for one request.
- Boxes are **pixel space, top-left origin, in the source image's natural size** — the existing `DetectionBox` contract. No new coordinate space anywhere.
- Rectangles are clamped to the image and enforce a minimum size **in the UI**; the server rejects nothing a hand-drawn box can produce.
- `?detected=<n>` keeps its blank/absent/zero distinctions. Do not touch that mechanism except to preserve `?page=` alongside it.
- Naming: **Auto unpack** / **Manual unpack**, **Move to trash** / **Restore** / **Delete forever** / **Empty trash**. `CONTEXT.md` is the authority; "discard" is demoted to an _Avoid_.
- Commit messages end `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Tests: `pnpm --filter @homebox/api test`, `pnpm --filter @homebox/web test` (Vitest); e2e `E2E_PORT=3200 npx playwright test -c e2e/playwright.config.ts` (the default `3100` collides with a dev stack).

## Rulings on spec gaps (binding — conflicts resolve against these)

1. **The manual provider ignores `bounds`.** It is handed the rectangles the user already clamped; it returns them unchanged. It must not clamp again — a second clamp is a second place for the two to disagree.
2. **`regions` are `{ name: string; box: { x, y, width, height } }[]`**, validated by zod with positive width/height. The server does not verify they are inside the image; the client clamps and the crop is best-effort. A region with a blank name is legal and falls through to `Draft N`.
3. **Two endpoints, one core.** `POST /upload/unpack/manual` (multipart: `photo`, `itemTypeId`, `regions` as a JSON field) and `unpack.manual` (tRPC: `{ imageId, regions }`). Both build the provider and call `createItemsFromImage`. Neither is a discriminated union with the auto paths.
4. **The modal owns its own `<img>` + `<svg>` pair.** It does not compose `PhotoViewer`, which has no overlay hook and whose dismissal rule (click the backdrop) would fight drawing.
5. **Pan is Space+drag; wheel zooms.** `zoom.ts`'s `zoomAt` clamps scale to `[fitScale, 1]`, so the modal cannot zoom past 1:1 — that is intended, not a bug to fix.
6. **The hue cycle is a fixed array of ~8 colours** in the modal module. No theme token, no palette config.
7. **Trash is per-instance, not per-user** — every user sees every trashed item, as they see every draft.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/db/src/schema.ts` | modify | `items.trashedAt` (`integer timestamp_ms`, nullable) |
| `packages/db/drizzle/0006_*.sql` + `meta/` | create | the migration |
| `apps/api/src/modules/items/repo.ts` | modify | trash predicates; `listDraftItems` paginated; `setItemTrashed`; `listTrashedItems`; detach helper for locations |
| `apps/api/src/modules/items/fts.ts` | modify | `computeBlob` returns `null` for trashed; `rebuildFTS` skips them |
| `apps/api/src/modules/items/service.ts` | modify | `deleteItem` → trash; `ItemDto.trashedAt` |
| `apps/api/src/modules/trash/` | create | `router.ts`, `service.ts` — list / restore / purge / purgeAll |
| `apps/api/src/modules/drafts/service.ts` | modify | `discardDraft` → trashing; `discardAll` → trashing |
| `apps/api/src/modules/drafts/router.ts` | modify | `list` gains `{ page, pageSize }` |
| `apps/api/src/modules/locations/service.ts` | modify | deep delete detaches items instead of deleting them |
| `apps/api/src/modules/images/service.ts` | modify | delete unlinks the three files |
| `apps/api/src/modules/itemTypes/service.ts` | modify | the in-use refusal names the trash count |
| `apps/api/src/modules/unpack/manual.ts` | create | regions → a one-request `DetectionProviderImpl` |
| `apps/api/src/modules/unpack/router.ts` | modify | `manual` procedure |
| `apps/api/src/modules/unpack/route.ts` | modify | `POST /upload/unpack/manual` |
| `apps/web/src/ui/Pagination.tsx` | create | the shared control |
| `apps/web/src/features/drafts/ManualUnpackModal.tsx` | create | the modal: image, overlay, handles, rows, footer |
| `apps/web/src/features/drafts/UnpackModal.tsx` | modify | two submits sharing one file input and type Select |
| `apps/web/src/features/drafts/DraftsPage.tsx` | modify | pagination, page-scoped selection, explicit all-actions, trash naming |
| `apps/web/src/features/trash/` | create | `TrashPage.tsx`, `index.ts` |
| `apps/web/src/features/items/ItemDetail.tsx` | modify | Auto/Manual unpack this photo; Move to trash |
| `apps/web/src/features/items/ItemsPage.tsx` | modify | adopt `Pagination` |
| `apps/web/src/features/locations/LocationsPage.tsx` | modify | the detach prompt and status copy |
| `apps/web/src/app/Shell.tsx`, `app/routes.tsx` | modify | the `/trash` route and nav item |
| `apps/web/src/locales/en/translation.json` | modify | every new string; every renamed one |

---

## Tasks

### Task 1 — `items.trashedAt` and its migration

**Files:** `packages/db/src/schema.ts`, `packages/db/drizzle/0006_*.sql`, `packages/db/drizzle/meta/*`

- [x] Add `trashedAt: integer('trashed_at', { mode: 'timestamp_ms' })` (nullable) to `items` in `packages/db/src/schema.ts`.
- [x] Generate the migration with `pnpm --filter @homebox/db exec drizzle-kit generate`. If it refuses because of the hand-written FTS virtual table (`0001_add_items_fts.sql`), hand-write `0006_*.sql` with a single additive statement:

  ```sql
  ALTER TABLE `items` ADD `trashed_at` integer;
  ```

  …and add both the `_journal.json` entry and the `meta/0006_snapshot.json`, following `0003_cute_tinkerer.sql`'s additive pattern. There is no `migrate` or `push` script in this repo — `packages/db/src/migrate.ts` applies whatever is in `drizzle/` at API startup.
- [x] `pnpm --filter @homebox/db build`.

**Verify:** a fresh DB (delete `data/homebox.db`, run `pnpm --filter @homebox/api seed`) has the column; an existing DB picks it up on next API start via `runMigrations`.

---

### Task 2 — the trash guard, at every query that reads `items`

**Files:** `apps/api/src/modules/items/repo.ts`, `apps/api/src/modules/items/fts.ts`, `apps/api/src/modules/itemTypes/repo.ts`, `apps/api/src/modules/drafts/*`, plus tests.

> **Enumerate by the *thing*, not by the string.** A query that reads `items` and carries **no** `published` predicate is exactly the case a grep for `published` misses — it is the analogue of a control with no classes. Search for the act of reading the table, not for the flag:
>
> ```
> grep -rn "from(items)\|FROM items\|items_fts\|prepare(" apps/api/src --include=*.ts
> ```
>
> Every hit that returns item rows goes in this task's list, whether or not it currently filters anything.

- [x] Produce that list before writing code, and paste it into the task's commit body.
- [x] Add `isNull(items.trashedAt)` to the base predicate in `buildWhere` (`items/repo.ts:96`) — this covers the catalog rows and every facet query composed from it.
- [x] Add it to `listDraftItems` (`items/repo.ts:327`), `countPublishedItemsOfType` (`itemTypes/repo.ts:143`) and `listNonEmptyValues` (`itemTypes/repo.ts:126`, and the JS filter at `itemTypes/service.ts:131`).
- [x] `computeBlob` (`items/fts.ts:50-61`) returns `null` for a trashed item, and `rebuildFTS` (`fts.ts:132-139`) skips them. **This is the one that bites:** without it an admin "rebuild search index" re-indexes every row and returns every trashed item to search results.
- [x] Tests: a trashed item appears in **none** of — catalog list, facets, FTS search, FTS snippet, drafts list, type item-count, field-value usage — and a `rebuildFTS` after trashing does not put it back into search.

**Verify:** `pnpm --filter @homebox/api test`, plus a hand-check that the enumerated list from step 1 has no entry left unguarded.

---

### Task 3 — trash service and router

**Files:** `apps/api/src/modules/trash/router.ts` (new), `apps/api/src/modules/trash/service.ts` (new), `apps/api/src/modules/items/repo.ts`, `apps/api/src/modules/items/service.ts`, `apps/api/src/modules/drafts/service.ts`, `apps/api/src/router.ts`, tests.

- [x] `setItemTrashed(db, id, at: Date | null)` in the items repo; `ItemDto` gains `trashedAt`. (Named `setItemTrashedAt`.)
- [x] `trashItem` / `restoreItem` / `purgeItem` in the trash service. Purge deletes the row (cascade takes children) and then best-effort unlinks `originalPath`, `editedPath` and `thumbPath` — move `discardDraft`'s unlink loop (`drafts/service.ts:49-54`) here, since this is now the only place files are destroyed.
- [x] `trash.list` paginated like `drafts.list` (Task 6's shape), returning trashed drafts and catalog items together with their `published` value so the page can label them.
- [x] `trash.restore` / `trash.purge` / `trash.purgeAll`. **Restore preserves `published`** — it is the only thing that distinguishes a draft from an item, so restoring must not touch it.
- [x] Point `drafts.discard` → `trashItem` and `drafts.discardAll` → trash each. `items.delete` → `trashItem`. Rename the procedures to say `trash` where the surface allows, keeping `items.delete`'s wire name only if something else depends on it.
- [x] Tests: trashing hides from catalog *and* drafts and keeps the files; restore returns a draft to drafts and an item to the catalog; purge removes the row and the files; `purgeAll` empties; a stale id in a bulk call is skipped, not fatal.

**Verify:** `pnpm --filter @homebox/api test`.

---

### Task 4 — location delete detaches; a single photo delete unlinks

**Files:** `apps/api/src/modules/locations/service.ts`, `apps/api/src/modules/locations/router.ts`, `apps/api/src/modules/images/service.ts`, `apps/web/src/features/locations/LocationsPage.tsx`, `apps/web/src/locales/en/translation.json`, tests.

- [x] `deleteLocation` (`locations/service.ts:157-193`): collect the subtree's item ids **first** (the existing `listSubtreeItemIds`), set their `locationId` to `null`, re-index each one (the search blob carries the location path — reuse `reindexItem`; `reindexLocationSubtree` re-reads the subtree and would find nothing once they are detached), then delete the locations deepest-first. **Do not delete items and do not unlink files.**
- [x] The route keeps returning counts; the item count now means *detached*. (A `deletePreview` query was added too — see the commit.)
- [x] `deleteImage` unlinks `originalPath`, `editedPath`, `thumbPath`. It stays a hard delete — a photo is not an item.
- [x] Web copy: the confirm becomes *"Delete "X" and its 2 sub-locations? 7 items will stay in your catalog with no location."*; the status becomes *"Deleted 3 locations. 7 items now have no location."*
- [x] Tests: `locations.test.ts` — the item survives, is `NOT_FOUND`-free, has a null location, is still searchable by name with no stale location path in the index; **the image-file-removal test is deleted**, because that behaviour is what this task removes.

**Verify:** `pnpm --filter @homebox/api test` and `pnpm --filter @homebox/web test`.

---

### Task 5 — manual unpack, server side

**Files:** `apps/api/src/modules/unpack/manual.ts` (new), `apps/api/src/modules/unpack/router.ts`, `apps/api/src/modules/unpack/route.ts`, tests.

- [x] `manualProvider(regions): DetectionProviderImpl` — `name: 'manual'`, `detectBoxes` returns `regions.map((r) => ({ box: r.box, label: r.name, confidence: 1 }))`, ignoring `bounds` and `image` (Ruling 1). It is constructed per request and never registered.
- [x] `RegionInputSchema` in the unpack module: `{ name: string (may be empty), box: { x, y, width, height } all non-negative ints, width/height > 0 }`, max a sane count.
- [x] `unpack.manual` (tRPC): `{ imageId, regions }` → load the image row, take the owning item's `itemTypeId` as the auto path does (`unpack/router.ts:20`), call `createItemsFromImage` with the manual provider.
- [x] `POST /upload/unpack/manual`: multipart `photo` + `itemTypeId` + `regions` (JSON string). Same auth, mimetype guard and temp-file handling as `/upload/unpack`.
- [x] Tests: N regions → N drafts, named from the region names; a blank name → `Draft 1`; coordinates land where expected (assert the crop's dimensions against the box); a non-decodable image → 400 as the auto route does; both endpoints 401 unauthenticated.

**Verify:** `pnpm --filter @homebox/api test`.

---

### Task 6 — `drafts.list` pagination, server side

**Files:** `apps/api/src/modules/drafts/router.ts`, `apps/api/src/modules/drafts/service.ts`, `apps/api/src/modules/items/repo.ts`, tests.

- [x] `listDraftItems(db, { page, pageSize })` gains `.limit(pageSize).offset(offset)` and a matching `COUNT(*)` over the same predicate — the same two-query shape as `runPlainSearch` (`items/repo.ts:240-243`).
- [x] Defaults `page ?? 1`, `pageSize ?? 20`, mirroring `items/repo.ts:249-252`.
- [x] `listDrafts` returns `{ items, total }` instead of a bare array.
- [x] Update `apps/api/test/drafts.test.ts` — nine assertions call `listDrafts(db)` and expect an array.

**Verify:** `pnpm --filter @homebox/api test`.

---

### Task 7 — the shared pagination control, and the items page adopting it

**Files:** `apps/web/src/ui/Pagination.tsx` (new), `apps/web/src/ui/index.ts`, `apps/web/src/features/items/ItemsPage.tsx`, tests.

- [x] Extract the control from `ItemsPage.tsx:313-323`: Prev / "Page N" / Next, disabled at the ends, driven by `{ page, total, pageSize }` and an `onPage` callback. Keep the page size in **one** place and pass it in.
- [x] `ItemsPage` adopts it; its query keeps sending `page` and no `pageSize` (server default), or starts sending `pageSize` explicitly — pick one and make the control's Next guard use the same value. The `20` must exist once.
- [x] Test: the control renders the current page, disables Prev at 1 and Next at the end, and calls `onPage` with the next value.

**Verify:** `pnpm --filter @homebox/web test`.

---

### Task 8 — the manual unpack modal

**Files:** `apps/web/src/features/drafts/ManualUnpackModal.tsx` (new), `apps/web/test/manualUnpack.test.tsx` (new).

- [x] Compose `Modal size="full"`. Inside: the image area (an `<img>` and an `<svg>` in one transformed wrapper), the row list, and the footer (Cancel / X / Submit).
- [x] Measure the natural size on the image's `load` and call `initialView` from `ui/zoom.ts`; wheel → `zoomAt`, Space+drag → `panBy`. The `space` keydown/keyup listeners go on the container, and Space must not scroll the page or re-trigger a focused button.
- [x] The `<svg>` carries `viewBox="0 0 <naturalWidth> <naturalHeight>"` and the wrapper carries `translate(x,y) scale(s)` with `transform-origin: 0 0` — the same transform string `PhotoViewer.tsx:261-271` uses — so a rectangle's coordinates are image pixels and need no conversion.
- [x] Convert a drag to image pixels by inverting that transform (or by measuring the overlay's own client rect and dividing by scale). **Test this**: a drag from screen point A to B produces the box you would compute by hand, at a non-1 scale and at a non-zero pan offset.
- [x] Rectangles: drag-empty draws, body-drag moves, 8 handles resize, all clamped to the image with a minimum size. Click selects; Delete removes the selection. **Escape is not bound** — it belongs to `Modal`.
- [x] Rows: crop preview, index + hue-cycle colour, name `<Input>`, delete button. Drawing focuses the new row's name field.
- [x] Submit is disabled with zero rectangles. Cancel/X/Escape confirm when rectangles exist (`window.confirm`).
- [x] Help text, visible in the modal: *"Drag on the photo to draw a box. Hold Space and drag to move the photo. Scroll to zoom. Click a box to select it; press Delete to remove it."*
- [x] Tests: draw → a row appears and is focused; delete removes both; clamping holds at the edges; the minimum size rejects a click without a drag; submit is disabled with nothing drawn; submit sends pixel coordinates in natural size.

**Verify:** `pnpm --filter @homebox/web test`.

---

### Task 9 — the drafts page, in one pass

**Files:** `apps/web/src/features/drafts/UnpackModal.tsx`, `apps/web/src/features/drafts/DraftsPage.tsx`, `apps/web/src/locales/en/translation.json`, `apps/web/test/drafts.test.tsx`.

The page is edited once, here, so pagination, the second unpack button and the trash rename land together.

- [ ] `UnpackModal`: keep the file input and type `Select` shared; two submit buttons — **Auto unpack** (the existing call) and **Manual unpack** (opens `ManualUnpackModal` on the chosen file). Both disabled until a file is chosen.
- [ ] `DraftsPage`: paginate via `drafts.list`'s new shape and the shared control; page in the URL as `?page=`, preserved when the `?detected=` cleanup rewrites the URL (`DraftsPage.tsx:64-69`).
- [ ] Selection is cleared when the page changes; "Select all" covers the page.
- [ ] The all-actions become **Publish all N** / **Move all N to trash**, calling the bulk procedures with **no** ids (the server's existing "every draft" branch). No cross-page checkbox.
- [ ] "Discard selected" → **Move to trash**; the confirm and status copy follow `CONTEXT.md`.
- [ ] Empty state keyed on `total === 0`; an out-of-range `?page=` clamps to the last page.
- [ ] The name `Input`'s `onBlur` flush is **left alone** (spec §20).
- [ ] Tests: pagination renders and moves the page; a page change clears the selection; the all-actions send no ids; the empty state appears only at `total === 0`; both unpack buttons are disabled without a file.

**Verify:** `pnpm --filter @homebox/web test`.

---

### Task 10 — the trash page and its nav entry

**Files:** `apps/web/src/features/trash/TrashPage.tsx` (new), `apps/web/src/features/trash/index.ts` (new), `apps/web/src/app/routes.tsx`, `apps/web/src/app/Shell.tsx`, `apps/web/src/locales/en/translation.json`, `apps/web/test/trash.test.tsx` (new).

- [ ] `/trash` route inside the `Shell` group, next to `/drafts`; a `navItems` entry **after Drafts, before Admin**; a `nav.trash` key.
- [ ] Rows: name, thumbnail, *trashed N ago*, a Draft/Item label, **Restore** and **Delete forever**. A footer **Empty trash**. Both destructive actions confirm, naming the count.
- [ ] Paginated with the shared control, same as drafts.
- [ ] Tests: a trashed draft and a trashed item both render with the right label; restore calls the right procedure; delete-forever and empty-trash confirm first and send the right payload.

**Verify:** `pnpm --filter @homebox/web test`.

---

### Task 11 — the item page buttons, and the copy sweep

**Files:** `apps/web/src/features/items/ItemDetail.tsx`, `apps/web/src/locales/en/translation.json`, `apps/web/test/itemDetail.test.tsx`, `apps/web/e2e/unpack.spec.ts`, `apps/web/e2e/00-catalog.spec.ts`.

> **The copy sweep enumerates by the *thing*, not the string.** The thing is "a user-facing label naming one of these actions" — including labels that never said "discard" or "unpack" and so cannot be found by grepping for those words. Enumerate from the i18n bundle and the JSX, not from the old vocabulary:
>
> ```
> grep -rn "t('drafts\.\|t('nav\.\|t('items\." apps/web/src --include=*.tsx
> grep -n "Discard\|discard\|Unpack\|unpack\|Delete photo\|Delete item" apps/web/src/locales/en/translation.json
> ```
>
> Every label that names deleting, discarding, or unpacking goes in this task's list.

- [ ] `ItemDetail`: **"Auto unpack this photo"** (rename of the hardcoded `"Unpack this photo"`, moved into `translation.json`) and a new **"Manual unpack this photo"** opening `ManualUnpackModal` on that photo, submitting via `unpack.manual`. Keep the shared `unpack` error surface (`ItemDetail.tsx:104-108`).
- [ ] **"Delete photo"** stays; **"Delete item"** becomes **"Move to trash"**, with the confirm no longer claiming to delete photos.
- [ ] Update `itemDetail.test.tsx` (`getAllByRole('button', { name: 'Unpack this photo' })` at `:208`, `:219`).
- [ ] Update `e2e/unpack.spec.ts`: the `'Unpack'` button name (`:66`), the empty-state copy assertion (`:99`), and the two-name set (`:79-84`) — which becomes deterministic once pagination gives the list a stable secondary sort or the spec counts the page instead of the set.
- [ ] Add e2e coverage for the two paths nothing currently exercises end to end: manual unpack (draw two boxes, name them, submit, see two drafts) and trash (trash an item, find it on `/trash`, restore it, see it back in the catalog).

**Verify:** `pnpm --filter @homebox/web test`, then `E2E_PORT=3200 npx playwright test -c e2e/playwright.config.ts`.

---

## Final verification

- [ ] `pnpm --filter @homebox/api test` and `pnpm --filter @homebox/web test` green.
- [ ] `pnpm --filter @homebox/web exec tsc --noEmit` clean (build `@homebox/api` first — its types come from `dist/`).
- [ ] The guard sweep re-run: every query that reads `items` from Task 2's enumeration carries the trash predicate, and a trashed item is absent from catalog, drafts, facets, search and type counts.
- [ ] `CONTEXT.md` terms match the shipped labels: no user-facing string says "discard" for the recoverable action.
- [ ] Doc drift: the spec's line references still resolve (the codebase moves).
