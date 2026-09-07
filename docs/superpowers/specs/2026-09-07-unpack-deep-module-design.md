# Unpack deep module — design spec

**Date:** 2026-09-07 · **Branch:** `unpack-deep-module` · **Builds on:** the in-bounds guarantee moved behind the detection seam (see `docs/superpowers/specs/2026-09-07-detection-box-bounds-design.md`).

## Problem

The `unpack` module's detect-and-crop pipeline is a wide orchestrator. `runUnpack` (service.ts) inlines the whole flow — settings lookup, provider lookup, `readFile`, detection, per-box item creation, crop writing, and image insert — while `writeCrop` is the only thing isolated. The callers re-derive the information the pipeline needs:

- `route.ts` measures the image itself via `sharp(buffer).metadata()` and 400s on non-decodable, then writes a temp file and passes the path plus the hand-measured `width`/`height`.
- `router.ts` reads stored `image.width/height` and guards against them being null.

The crop/file-layout/thumb knowledge (uuid layout, `sharp` extract, original + thumb encode, mkdir, relative-path storage) has no single home and exists inside a function that is really an orchestrator, not a module. With #1 landed the providers already guarantee in-bounds boxes, so the pipeline no longer needs its own out-of-frame protection — the remaining friction is that the pipeline's contract is a wide one and measurement is duplicated at the caller.

## The decision (shared understanding, confirmed 2026-09-07)

1. **One deep module, one interface.** Re-surface the pipeline as a single exported function `createItemsFromImage(ctx, source)` that owns detect → clamp (via provider) → filter → crop → persist. The internals (settings, registry, sharp, mkdir, uuid layout) are private.

2. **The module owns image measurement.** `UnpackSource` drops `width`/`height`; the module calls `sharp(buffer).metadata()` once and uses those dims both as the `detectBoxes` bounds and as the crop source of truth. Callers stop measuring.

3. **`UnpackSource` is `{ path: string; itemTypeId: number }`.** The module `readFile`s the path. (`path` over `buffer` — the route already writes a temp file and passes a path; the tRPC `item` path passes the existing on-disk original path. Keeps the module reading + measuring + writing, and minimizes churn.)

4. **Not-decodable contract.** The module throws a typed `UnpackError('image-not-decodable')` when `metadata.width/height` are absent. The route catches it and returns 400. This replaces the old route-level `sharp.metadata` + 400 check.

5. **Provider wiring unchanged.** The process-global `detectionRegistry` and `getSettings(db)` stay internal to the module (candidate #3 — carrying the provider in `ctx` — is explicitly deferred).

6. **`saveCrop`.** `writeCrop` is renamed `saveCrop` and stays module-private: uuid layout, `sharp(buffer).extract`, `jpeg(90)` original + `resize(400).jpeg(80)` thumb, mkdir, writeFile, crop metadata.

## What does NOT change

- `UnpackResult` stays `{ detected: number; drafts: { id: number; name: string; imageId: number }[] }`.
- The zero-area filter (`.filter((b) => b.box.width > 0 && b.box.height > 0)`) stays.
- `DetectionBox` shape, provider interface, and `detectionProvider` settings values are untouched.
- The global `detectionRegistry` and the `/upload/image` file-writer twin in `uploads.ts` are left as-is (deferred / out of scope).
- `resolveItemType` and the mimetype guard stay in `route.ts` (HTTP-layer concerns, not the pipeline).
