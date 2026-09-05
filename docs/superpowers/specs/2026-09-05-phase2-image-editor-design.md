# Phase 2 — Non-destructive Image Editor Design

**Goal:** Let an item's photo be edited in the browser (crop, rotate, resize, text, draw, filters) without destroying the original — the edited version is stored separately, the thumbnail is regenerated from it, and re-editing always restarts from the original.

**Scope:** Editor only. No visual redesign, no dark mode, no Tailwind adoption, no document (attachment) editing, no object-detection/"unpack" flow, no delete/orphan-file cleanup.

**Tech:** `filerobot-image-editor` (client) + the existing Fastify/`sharp` upload pipeline. Non-destructive storage via the already-present `images.edited_path` column.

**Spec this plan implements:** this design doc.

## Current state (Phase 1, merged)

- `POST /upload/image` (multipart, `itemId` + file) → saves `uploads/originals/<uuid>.<ext>` + a 400px thumb `uploads/thumbs/<uuid>.jpg`, inserts an `images` row.
- `GET /file/<relpath>` serves any file under `DATA_DIR` (public — required because `<img src>` tags can't send a Cookie header). No static-cache headers are set.
- `images` table already has: `id, itemId, originalPath, editedPath (nullable, never written), thumbPath, width, height, format, sizeBytes, sortOrder, isPrimary`.
- `ImageDto` = `{ id, originalPath, thumbPath, isPrimary }` — does **not** expose `editedPath`.
- Web: `PhotoUpload` (file input → `/upload/image`), `ItemDetail` renders `item.images` as a grid of `<img src="/file/{thumbPath}">`. No editor.
- `MAX_UPLOAD_MB` is a module constant (default 10; `process.env.MAX_UPLOAD_MB` overrides). No instance_settings table yet.

## The non-destructive contract

An image has up to two stored versions: `original_path` (immutable, the uploaded photo) and `edited_path` (nullable, the user's edited export). The display resolution is **`edited_path ?? original_path`**. Re-editing **always** loads `original_path`, so every edit restarts from the untouched original — that is the non-destructive guarantee. The `thumb_path` is derived from the *displayed* image, so it reflects the edited version once one exists.

`DATA_DIR` layout: `uploads/originals/`, `uploads/edited/`, `uploads/thumbs/`.

## API

### `POST /upload/image/edit` (multipart)

Auth: any authenticated user (same gate as `/upload/image` — `parseSessionCookie` → `getSessionUser`; `401 UNAUTHORIZED` without a session). The image belongs to an item, which is itself auth-gated.

Fields:
- `imageId` — text; the `images.id` to edit. Must parse to a positive integer (`400` otherwise).
- `file` — the edited image blob.

Validation (order): no file part → `400`; invalid/missing `imageId` → `400`; MIME not `image/*` → `400`; size > `MAX_UPLOAD_MB` → `413`; no row for `imageId` → `404`.

Behavior:
1. Read the blob, guard `buffer.length > maxUploadBytes` → `413`.
2. `sharp(buffer).metadata()` → new `width`/`height`.
3. Save the edited blob as `uploads/edited/<uuid>.<ext>` (`ext` from filename, else MIME — filerobot defaults to PNG → `.png`).
4. Regenerate the thumb from the **edited** blob (`sharp(buffer).resize({ width: 400 }).jpeg({ quality: 80 })`) to a **new** file `uploads/thumbs/<uuid>.jpg`.
5. Update the row: `editedPath`, `thumbPath`, `width`, `height`, `format`, `sizeBytes`. `originalPath`, `sortOrder`, `isPrimary`, `itemId` are untouched.
6. Return the updated `ImageDto`.

Notes:
- Written with a **new thumb file** each edit so the URL changes and no stale cache is served (`/file/*` sets no cache headers).
- Orphaned old thumb/edited files are a known follow-up; not cleaned here (out of scope).
- `GET /file/uploads/edited/<uuid>.png` already works — `MIME_BY_EXT` includes `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, etc., and `resolveInside` keeps the path inside `dataDir`.

### `ImageDto` (additive)

```
{ id, originalPath, editedPath | null, thumbPath, isPrimary }
```
The client uses `editedPath ?? originalPath` for the full-image view and always `originalPath` as the editor source. `editedPath` is a new field; the tRPC contract types update automatically.

## Frontend

### Dependencies

Add to `apps/web`:
- `filerobot-image-editor` (pinned to a React-19-compatible version)
- `react-konva` and `styled-components` (required peer deps of the editor; pin React-19-compatible versions)

### `PhotoEditor` (modal, `apps/web/src/features/upload/PhotoEditor.tsx`)

Props: `{ image: { id: number; originalPath: string }, itemId: number, open: boolean; onClose: () => void }` — `itemId` is needed because `PhotoEditor` invalidates the item-scoped `items.get`/`items.list` queries after a save.

When `open`, render a full-screen overlay containing:
```jsx
<FilerobotImageEditor
  source={'/file/' + image.originalPath}
  onSave={handleSave}
  onClose={/* close the modal */}
/>
```
- `source` is always the **original** path (non-destructive re-edit).
- `handleSave(imageData, _designState)`:
  1. Derive a Blob from the edited image — prefer `imageData.canvas.toBlob(...)`, fallback to decoding `imageData.imageBase64` (Base64 → Uint8Array → `Blob([...], { type: imageData.mimeType ?? 'image/png' })`). If neither is available, do nothing and surface an error.
  2. `new FormData()` → append `imageId` (String) + `file` (the Blob).
  3. `await fetch('/upload/image/edit', { method: 'POST', body: formData, credentials: 'include' })`; if `!res.ok`, surface the status.
  4. On success, `utils.items.list.invalidate()` and `utils.items.get.invalidate({ id: itemId })`; call `onClose()`.
  5. Show a busy state while saving; `role="alert"` on error.

The editor's own `src` image loads from the public `/file/*` route, so no Cookie is needed for it to appear.

### `ItemDetail` (`apps/web/src/features/items/ItemDetail.tsx`)

- Each image gets an **Edit** button → opens `PhotoEditor` for that image (track `editingImageId`/`open` state).
- Thumbnails continue to render `/file/{thumbPath}`; once the row's `thumbPath` changes the grid updates (the item queries are invalidated by `PhotoEditor`). No display change needed.
- A full-image link ("View") points to `/file/{editedPath ?? originalPath}` — shows the edited version when present, else the original.

## Testing

### API (`apps/api/test/uploads.test.ts`, extend the existing file or add `uploadsEdit.test.ts`)

Full auth, per the existing upload test's fixture (a logged-in session + an item):
- **Happy path:** create an item; `POST /upload/image` to get an image row; `POST /upload/image/edit` with a *different* buffer → assert the response `editedPath` is set, `thumbPath` changed (and the new thumb file exists and differs from the old), `originalPath` unchanged, `width`/`height` reflect the edited image.
- **Auth:** `POST /upload/image/edit` without a session → `401`.
- **Bad id:** `imageId` that isn't a positive integer → `400`; unknown `imageId` → `404`.
- **MIME:** a non-`image/*` file → `400`.
- **Size:** a buffer over `MAX_UPLOAD_MB` → `413`.

### Web (`apps/web/test/photoEditor.test.tsx`)

- `vi.mock('filerobot-image-editor')` to a stub that calls `onSave` with a fake `imageData` (offer `canvas.toBlob`); assert `fetch('/upload/image/edit')` is called with a `FormData` containing `imageId`, and the item queries are invalidated on success.
- `ItemDetail` test: an image row renders an **Edit** button that opens the editor (could live in `catalog.test.tsx`).

### E2E (`apps/web/e2e/catalog.spec.ts`)

- Extend the happy path: after creating an item, `page.setInputFiles` on the upload input and assert a thumbnail `<img>` appears (tests the upload leg of the pipeline). Filerobot canvas interaction is brittle under Playwright, so editing stays covered by unit tests, not E2E.

## Out of scope (documented, deferred)

- Any visual design/theme/Tailwind pass (user chose "editor only").
- Document (attachment) editing.
- Deleting orphaned `original`-derived thumb/edited files (a cleanup follow-up; they are small).
- `instance_settings.max_upload_mb` (still the `MAX_UPLOAD_MB` constant; a settings table is a later phase).
- Re-encoding/compression policy beyond `sharp`'s existing 400px JPEG thumb.

## Verification

- `pnpm -r build` clean.
- `pnpm -r test` green (API edit tests + web editor tests).
- `pnpm --filter @homebox/web test:e2e` green (upload leg).
- Manual: open an item → Edit a photo → crop/annotate → Save → the card thumbnail and detail view show the edited image; re-open Edit → the editor reloads from the **original**; the original file on disk is untouched.
