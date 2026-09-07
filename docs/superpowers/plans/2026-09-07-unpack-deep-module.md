# Unpack deep module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the detect-and-crop pipeline in `apps/api/src/modules/unpack` into one deep module — a single exported `createItemsFromImage(ctx, source)` that owns image measurement, detection, filtering, cropping, and persistence — so callers stop re-deriving image dimensions and the crop/file-layout knowledge has one home.

**Architecture:** `createItemsFromImage(ctx, { path, itemTypeId })` reads the file, measures it once via `sharp(...).metadata()`, uses those dims as the `detectBoxes` bounds (the #1 in-bounds guarantee is now the only protection — no out-of-frame logic in this module), filters degenerate boxes, and per box does `createItem` → `saveCrop` → `insertImage`. The global `detectionRegistry` and `getSettings(db)` stay internal. A typed `UnpackError('image-not-decodable')` signals an unmeasurable image.

**Spec:** `docs/superpowers/specs/2026-09-07-unpack-deep-module-design.md`

## Global Constraints

- Monorepo build order `shared → db → api → web`; this change is `apps/api` source + `apps/api` tests only — no shared/db/web edits.
- `UnpackSource = { path: string; itemTypeId: number }` (width/height removed). `UnpackResult` unchanged.
- The module owns measurement (calls `sharp(buffer).metadata()`); callers stop measuring / stop reading stored dims.
- The zero-area filter (`.filter((b) => b.box.width > 0 && b.box.height > 0)`) is preserved.
- Provider wiring is unchanged: `detectionRegistry.get(getSettings(db).detectionProvider)`. `detectionProvider` setting values untouched.
- The global `detectionRegistry` stays (candidate #3 deferred). `/upload/image` writer in `uploads.ts` untouched.
- Tests must pass: `pnpm --filter @homebox/api test` (Vitest). Commit messages end `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `apps/api/src/modules/unpack/errors.ts` | create | `UnpackError` class + `UnpackErrorCode = 'image-not-decodable'` |
| `apps/api/src/modules/unpack/service.ts` | modify | rename `runUnpack` → `createItemsFromImage`; `UnpackSource` drops width/height; measure once via `sharp(...).metadata()`; throw `UnpackError('image-not-decodable')`; rename `writeCrop` → `saveCrop` |
| `apps/api/src/modules/unpack/route.ts` | modify | drop `sharp.metadata` + `400 "not a decodable image"`; catch `UnpackError` → 400; call `createItemsFromImage` without width/height |
| `apps/api/src/modules/unpack/router.ts` | modify | drop stored-dims read + `width == null` guard; call `createItemsFromImage` without width/height |
| `apps/api/test/unpack.test.ts` | modify | drop width/height from `source` in the unit test; add a not-decodable case (non-image buffer → `UnpackError`) |
| `apps/api/test/drafts.test.ts` | modify | drop width/height from `source` in the fixture |

## Rulings on spec gaps (binding — conflicts in the plan/text resolve against these)

1. **`path` over `buffer`.** The source carries a path; the module `readFile`s it. The route keeps writing its temp file and passing the path (the cleanup wart at route.ts:49-56 is route-layer, not part of the pipeline, and out of scope); the tRPC `item` path passes the on-disk original path. Neither caller needs a buffer before the module.
2. **Not-decodable → typed error, not a return sentinel.** An unmeasurable image is an error condition, not the empty-detection case; conflating them would silently return `{ detected: 0, drafts: [] }` for a corrupt image. Throw `UnpackError('image-not-decodable')`; the route maps it to 400.
3. **`resolveItemType` + mimetype guard stay in `route.ts`.** They're HTTP/request-layer, not the pipeline.
4. **No change to the `0-area` filter or the in-bounds contract.** With #1, providers already guarantee in-bounds boxes; this module adds no clamp, only the filter.

---

## Tasks

### Task 1 — Migrate the unpack pipeline to the deep module shape

**Files:** errors.ts (new), service.ts, route.ts, router.ts, test/unpack.test.ts, test/drafts.test.ts.

**Do:**
- Add `apps/api/src/modules/unpack/errors.ts` exporting `UnpackError` (`class UnpackError extends Error { code: UnpackErrorCode }`) and `UnpackErrorCode = 'image-not-decodable'`.
- `service.ts`: rename export `runUnpack` → `createItemsFromImage`; change `UnpackSource` to `{ path, itemTypeId }`; inside, after `readFile(source.path)`, `const meta = await sharp(buffer).metadata()` and `if (!meta.width || !meta.height) throw new UnpackError('image-not-decodable')`; pass `{ width: meta.width, height: meta.height }` as the `detectBoxes` bounds; rename `writeCrop` → `saveCrop`. Keep the zero-area filter, the per-box `createItem`/`saveCrop`/`insertImage` loop, and `UnpackResult` unchanged.
- `route.ts`: remove its `sharp(buffer).metadata()` block and the `400 "not a decodable image"` check; wrap the `createItemsFromImage` call so `UnpackError` → `reply.code(400).send({ error: 'not a decodable image' })`; call `createItemsFromImage({ db, dataDir, userId: user.id }, { path: tmpPath, itemTypeId })`. Keep the mimetype guard, `resolveItemType`, temp-file write, and `finally` rm.
- `router.ts`: remove the `image.width == null || image.height == null` guard; call `createItemsFromImage({ db: ctx.db, dataDir: ctx.dataDir, userId: ctx.user!.id }, { path: join(ctx.dataDir, image.originalPath), itemTypeId: sourceItem.itemTypeId })`.
- Tests: update `unpack.test.ts` unit case and `drafts.test.ts` fixture to drop `width`/`height` from the `source` object.

**Acceptance:** `pnpm --filter @homebox/api test` green; the unpack + drafts suites pass; no call site passes `width`/`height` to the module; no `sharp.metadata` remains in `route.ts`.

- [ ]

### Task 2 — Cover the not-decodable path

**Files:** test/unpack.test.ts.

**Do:** Add a unit case asserting that `createItemsFromImage` throws `UnpackError('image-not-decodable')` when given a source whose file is not a decodable image (e.g. write a small non-image buffer, or a truncated buffer, to a temp path and call the function). Also assert the route maps it to 400 if the route test is easy to extend; otherwise assert the thrown error at the service level.

**Acceptance:** the new case passes and runs as part of `pnpm --filter @homebox/api test`.

- [ ]
