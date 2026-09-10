# HomeBox-BG — Phase 6: Unpack / Drafts / Publish + Detection Providers Spec

**Date:** 2026-09-06
**Status:** Draft for review
**Type:** Incremental design (extends `2026-09-04-homebox-ng-design.md`, `2026-09-06-phase5-admin-backup-design.md`)

## Overview

Phase 6 delivers the **unpack (multi-item photo import)** flow and the **draft / publish lifecycle** the
master spec describes, along with the **real detection providers** that drive it. Phase 5 shipped only the
empty `DetectionProviderRegistry` + `instance_settings.detection_provider` surface ("the interface and setting exist
now; providers wire in later"). This phase wires them in and builds the flow on top.

It introduces:

- **Three concrete detection providers** behind the existing `DetectionProvider` interface:
  a **local** transformers.js model, **OpenAI** (vision), and **Google Gemini** (vision).
- **Unpack**: detect boxes in a clustered photo → crop each → create a **draft item** (`published=false`, no
  location) with the cropped image as its primary photo and the auto-label as its name. Two entry points:
  a **root** action (standalone photo) and an **item-photo** action (unpack an existing item's photo; the
  original item stays).
- **Drafts page**: review/edit labels, select, publish single / publish-all, discard.
- **A `published=true` filter on the shared catalog path** so drafts never leak into the catalog or search.

**Out (deferred to later phases / non-goals — follow-on phases):**
- Document upload pipeline (`POST /upload/document`). Noted in Phase 5 as landing later.
- Docker packaging.
- Non-English translations (i18n architecture ready; strings bundled under `en`).
- Real local-model fine-tuning (ship a generic model; a bespoke vocabulary is future work).
- Unpublish (reverting a published item to draft) — rare admin op, deferred per the master spec.

## Current state (what this changes)

- `packages/db/src/schema.ts` — `items` has `published: integer(..., { mode: 'boolean' }).notNull().default(true)`
  (line 66). `instance_settings` has `detectionProvider: text('detection_provider', { enum: ['remote','local'] })`
  + `detectionConfig: text('detection_config', { mode: 'json' })` (lines 95-101). `images` has
  `originalPath`/`editedPath`/`thumbPath`/`isPrimary` (lines 112-124). **No schema change needed** — the
  `published` column and detection config already exist.
- `apps/api/src/modules/detection/provider.ts` — `DetectionBox`, `DetectionProvider`, `DetectionProviderRegistry`,
  `detectionRegistry` singleton, all present and empty. **The interface is reused as-is.**
- `apps/api/src/modules/items/repo.ts` — `searchItems` + the shared facet/list paths (`buildWhere`,
  `listFacets`, etc.) do **NOT** filter on `published`. This is the one cross-cutting change.
- `apps/api/src/modules/items/service.ts` — `listItems` hydrates rows from `repo.searchItems`.
- `apps/api/src/uploads.ts` — the image upload/edit path with the `sharp` thumb pipeline (lines 100-124, 180-200);
  `createImageFromBuffer`-style logic for originals + thumbs is reusable for per-box crops.
- `apps/api/src/trpc.ts` — `protectedProcedure`, `adminProcedure` exist.
- `apps/web/src/features/` — `items`, `auth`, `home`, `settings`. **No `drafts` feature**; no `/drafts` route.

## Architecture

### A. Detection providers — `apps/api/src/modules/detection/`

Keep the existing interface unchanged:

```ts
export type DetectionBox = { box: { x: number; y: number; width: number; height: number }; label: string; confidence: number }
export interface DetectionProvider { name: string; detectBoxes(image: Buffer): Promise<DetectionBox[]> }
```

Add three providers, all `register`ed into `detectionRegistry` at app startup. Each resolves `instance_settings`
→ picked by `detection_provider` string. All box output is **normalized to pixel coordinates (top-left origin,
`{x,y,width,height}`)** at the provider boundary so `unpack` and `DetectionBox` never see provider-specific spaces.

**`detection_provider` enum change.** Phase 5 shipped `detection_provider` as `text('detection_provider', { enum:
['remote', 'local'] })` — the coarse "remote vs local" knob from the master spec. With three concrete providers
selected by name, `remote` can no longer select *which* remote engine. This phase widens the enum to
`['local', 'google', 'openai']`, one value per concrete provider, so `getInstanceSettings().detectionProvider`
maps 1:1 onto `detectionRegistry.get(name)`. This is **a small Drizzle migration** (SQLite has no enum constraint —
it's a `text` column with a TS-level enum, so the migration is a no-op on the column and only the app-level enum
changes; confirm the existing rows `remote` are migrated to `google` by default, or seeded fresh). Keep the
`remote`→`google` default mapping so a Phase 5 instance picks a sensible provider without manual re-entry. The
admin UI's `detection_provider` radio lists `local` / `google` / `openai`.

- **`local.ts`** — `@huggingface/transformers`. `pipeline('object-detection', modelId, { device, dtype: 'q8' })`.
  Default model `onnx-community/rfdetr_nano-ONNX`, configurable via `detection_config.model`. Runs in-process
  (WASM, or WebGPU when the runtime supports it). The pipeline returns
  `[{ label, score, box: { xmin, ymin, xmax, ymax } }]` → mapped to `{ x: xmin, y: ymin, width: xmax-xmin, height: ymax-ymin }`.
  Model downloaded on first use into `DATA_DIR/models/detection/` (`env.cacheDir`), surfaced via a
  `progress_callback`; subsequent calls reuse cache. **Failure mode:** download/connectivity failure → throw
  `DetectionProviderError('model-unavailable', ...)` with a message pointing at the admin CLI script.
- **`openai.ts`** — `openai` package. Sends image base64 + a JSON-mode system prompt requesting
  `{ detections: [{ label, box: [x, y, width, height] (pixels, top-left), confidence }] }`; reads
  `OPENAI_API_KEY` from env. Default model `gpt-4o-mini`, configurable. Clamps boxes to the image bounds.
- **`google.ts`** — `@google/genai` package. Sends base64 inline data + a prompt requesting `box_2d`
  `[ymin, xmin, ymax, xmax]` normalized to 0-1000; `responseMimeType: 'application/json'`. Rescales to pixels.
  Reads `GEMINI_API_KEY` from env. Default model `gemini-2.5-flash`, configurable.

**Error typing:**

```ts
// provider-errors.ts
export type DetectionProviderErrorCode = 'not-configured' | 'model-unavailable' | 'api-error' | 'rate-limited'
export class DetectionProviderError extends Error {
  constructor(readonly code: DetectionProviderErrorCode, message: string) { super(message); this.name = 'DetectionProviderError' }
}
```

`not-configured` when (a) the `detection_provider` name maps to no registered provider, or (b) the required env
key (`GEMINI_API_KEY` / `OPENAI_API_KEY`) is unset. The UI renders code-specific messages.

**Secrets:** API keys are read **only** from `process.env`. Never from `detection_config`, never echoed to the
browser, never persisted. `detection_config` holds only non-secret knobs (model id, confidence threshold, device).

**Local-model admin CLI script** — `apps/api` gains `scripts/detection-model.ts`, wired as
`pnpm --filter @homebox/api detection:model`:

- Checks `DATA_DIR/models/detection/` for the configured model.
- Present → prints "ready".
- Absent → downloads on demand (progress + size), then prints "downloaded to <path>".
This gives a first-run path that avoids the slow in-request download. The in-request path still auto-downloads
as a fallback, so the script is an optimization, not a requirement.

### B. Unpack module — `apps/api/src/modules/unpack/`

**`service.ts`:**

```ts
export const runUnpack = async (db, image: { path: string; width: number; height: number }, source: 'root' | 'item', userId) => {
  // 1. settings → provider
  const settings = getInstanceSettings(db)
  const provider = detectionRegistry.get(settings.detectionProvider)
  if (!provider) throw new DetectionProviderError('not-configured', 'detection provider not configured')
  // 2. detect
  const buffer = await readFile(image.path)
  const boxes = await provider.detectBoxes(buffer)   // pixels, top-left
  if (boxes.length === 0) return { detected: 0, drafts: [] }
  // 3. for each box: crop + write originals+thumb + insert images row + items row (published=false, no location)
  //    boxes may overlap → keep all, no dedupe. Each draft gets ONLY its own crop — the source photo is
  //    NOT retained (a root-photo's source is discardable; an item-photo's source stays on the origin item).
  // 4. return { detected, drafts: [{ id, name, imageId }] }
}
```

Each draft item: `published=false`, `locationId=null`, `createdBy=userId`, `name=label`, single `images` row
with the cropped image as `originalPath`/`thumbPath` (gated on `isPrimary=true`). Reuses the existing `sharp`
thumb/resize logic (match `uploads.ts` conventions: `originals/<uuid>.<ext>`, `thumbs/<uuid>.jpg`).

**Router `unpack.router.ts`** (mounted at `app/` under `unpack`):

- `unpack.run` — `protectedProcedure`. Input is a discriminated union:
  - `{ kind: 'root', photo: <multipart image> }` → upload the standalone photo, then unpack it. Requires the
    `POST /upload/image` route (or a dedicated multipart handler) to front this, since tRPC can't take multipart
    directly.
  - `{ kind: 'item', imageId: number }` → unpack an already-attached image (from an item's photo).
- Returns `{ detected: number, drafts: [{ id, name, imageId }] }`.

Because multipart is tRPC-hostile (mirroring the Phase 5 backup/image route pattern), the `root` action's
multipart upload goes through a raw Fastify route (`POST /upload/unpack`) that writes the photo to a temp path,
calls `runUnpack`, and returns the same `{ detected, drafts }` shape, gated by the existing cookie-auth +
role check. The `item` action stays a normal tRPC procedure.

### C. Drafts module — `apps/api/src/modules/drafts/`

All `protectedProcedure`. Draft = `items.published=false`.

- `drafts.list` — hydrate all unpublished items (`published=false`) with image thumb, type, tags (reuse the
  `listItems` hydration approach).
- `draft.update` — `{ id, name }` → rename the label (`items.name`).
- `draft.publish` — `{ id }` → `published=true`.
- `drafts.publishAll` — `{ ids?: number[] }` → publish all drafts, or only the selected ids.
- `draft.discard` — `{ id }` → **delete** the draft item row (cascade removes its `images`), and delete the
  orphaned image files on disk.

### D. The `published=true` filter (cross-cutting)

`repo.searchItems` and its sibling facet/list paths must render only `published=true` items. Add a base predicate
`eq(items.published, true)` to the shared WHERE construction (`buildWhere`/predicate) so the catalog, search, and
facets all exclude drafts. Strictly additive today (no `published=false` rows exist until this phase creates them),
so no Phase 3/4 regression — but it is explicitly tested.

FTS: drafts may appear in `items_fts` (they're in `items`), but because every read path filters `published=true`,
search never surfaces them. `rebuildFts` is unchanged. If a later phase wants drafts searchable, it can relax the
predicate; this phase does not.

### E. Web — `apps/web/src/features/drafts/` + unpack UI

- **`DraftsPage.tsx`** — route `/drafts` (auth, inside the Shell, nav entry). Lists drafts: thumbnail, editable
  label, select checkbox, per-item **Publish**, per-item **Discard**, and a **Publish all / publish selected**
  button. Uses `trpc.drafts.*` + react-query invalidation. Matches existing `/settings`/`ItemsPage` conventions.
- **Unpack surface:**
  - **Root:** a control (modal or a "Unpack a photo" action) → upload a clustered photo via
    `POST /upload/unpack` → navigate to `/drafts` with `detected` count.
  - **Item-photo:** on the item detail / photo view, a "Unpack this photo" action → `unpack.run({ kind:'item',
    imageId })` → navigate to `/drafts`.
  - Both render the detected count; 0 detected → informative empty state, no error.
- Nav entry "Drafts" appears only within the authenticated Shell.

## Authentication & authorization

- `unpack.run` (item), all `drafts.*` are `protectedProcedure` (any authenticated user — items/import are
  household-shared and user-editable like the rest of the catalog).
- The raw `POST /upload/unpack` route replicates the image routes' cookie-auth + role check.
- The local-model admin CLI script requires filesystem access (server-side); it is not an HTTP surface.

## Error handling & security

- Provider errors typed (`DetectionProviderError`) with codes; the UI renders per-code friendly messaging and
  never a raw stack.
- Boxes are clamped to the image bounds on every provider so a malformed/out-of-range box can't produce a
  `sharp.extract` crash or a negative crop.
- Cropping uses the decoded image dimensions (from `sharp.metadata()`), not a provider-supplied guess.
- Draft images are written via the same guarded path as existing uploads (no path traversal; UUID filenames).
- No new secret handling: API keys are env-only. `process.env` key checks throw a clear `not-configured` error
  rather than a cryptic network failure.
- Discard deletes DB rows (cascade) and best-effort removes the orphaned image files; a file-removal failure is
  logged, not fatal (the DB cascade keeps the catalog consistent).

## Testing

**Backend (Vitest, temp SQLite):**
- Provider config: `detectionRegistry.get('local' | 'google' | 'openai')` returns the registered provider;
  an unregistered name → `not-configured`; missing env key → `not-configured` (for google/openai).
- Provider box normalization: each provider's mocked client returns its native format
  (transformers `{xmin,ymin,xmax,ymax}` / OpenAI `[x,y,w,h]` / Gemini `box_2d 0-1000`) and is asserted to map to
  `{x,y,width,height}` pixels, clamped to bounds.
- **Unpack integration** (fake provider returning fixed boxes): `runUnpack` creates one draft per box, each with a
  crop derived from the box, `published=false`, no location, `created_by` = user; `detected` count correct; empty
  boxes → `{ detected: 0, drafts: [] }` with no error; a box outside bounds is clamped, not crash.
- **`published=true` filter**: catalog/list/search hide `published=false`; a published item shows. Non-vacuous:
  create a draft + a published item, assert only the published one appears.
- Drafts lifecycle: `drafts.list` returns only unpublished; `draft.update` renames; `draft.publish` sets
  `published=true` and it leaves `drafts.list`; `drafts.publishAll` publishes all/selected; `draft.discard` removes
  the row + images.

**Frontend (Vitest + React Testing Library):**
- DraftsPage renders thumbnails, label edit, publish/discard/all; the `published` catalog filter is unit-tested.
- The unpack entry points render detected count; the 0-detected empty state.

**E2E (Playwright) — mock provider:** a test hook injects a deterministic `DetectionProvider` (fixed boxes)
into `detectionRegistry` before the app starts (test-only, gated behind `NODE_ENV=test`/a test env var). Flow:
upload a clustered photo → unpack → drafts appear → edit a label → publish → the item shows in the catalog.
The three real providers are unit/integration-tested against **faked clients** (never the live APIs) and the
local model is exercised only via the admin script check in CI (download smoke test, killed if it would slow the
suite).

## Migration

A small Drizzle migration widens `instance_settings.detection_provider` from `['remote', 'local']` to
`['local', 'google', 'openai']` (see section A). SQLite stores this as a plain `text` column with no native enum
constraint, so the migration is primarily a data fix: any existing `remote` row is remapped to `google` (the
default remote engine) so a Phase 5 instance still works. `items.published`, `images`, and
`instance_settings.detection_config` are unchanged — no new columns.

## Open questions / deferred

- **Real local model in CI** — not used in the Playwright suite (mock provider instead). The admin CLI script
  provides the pre-download path. Whether to also network-ship the model in Docker is deferred to the Docker phase.
- **Draft image retention (resolved)** — each draft keeps only its own crop; the source photo is NOT retained in
  any draft (a root-photo source is discardable; an item-photo source stays on the origin item). No merge/re-grid
  rework in this phase.
- **Overlapping-box dedupe** — deliberately keep all boxes (no NMS) per the master spec's "boxes may overlap".
  If the model overproduces overlapping crops, a future `mNMS`/threshold knob is a `detection_config` addition.
