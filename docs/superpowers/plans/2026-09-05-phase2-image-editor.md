# Phase 2 — Non-destructive Image Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an item's photo be edited in the browser (`react-filerobot-image-editor`) without destroying the original — the edited version is stored to `images.edited_path`, the thumbnail is regenerated from it, and re-editing always reloads `original_path`.

**Architecture:** A new multipart endpoint `POST /upload/image/edit` writes the edited blob to `uploads/edited/`, regenerates the thumb from it, and updates the row (leaving `original_path` untouched). The web client opens the editor on the original, posts the edited blob, and invalidates the item queries. `ImageDto` gains `editedPath` so the client can show the edited full image and know editing is available.

**Tech Stack:** Fastify + `@fastify/multipart` + `sharp` (backend); React 19 + `react-filerobot-image-editor@^4.9.1` (+ peers `react-konva`, `styled-components`) (frontend). Editor **only** — no visual redesign, no Tailwind, no dark mode, no attachment editing, no orphan-file cleanup.

**Spec:** `docs/superpowers/specs/2026-09-05-phase2-image-editor-design.md`

## Global Constraints

- **Non-destructive:** `original_path` is never modified. Display resolution is `edited_path ?? original_path`. Re-editing always loads `original_path`.
- **Thumbnails:** regenerated from the *displayed* image via `sharp(...).resize({ width: 400 }).jpeg({ quality: 80 })`, written to a **new** file path each edit (so no stale cache is served — `/file/*` sets no cache headers).
- **`MAX_UPLOAD_MB`** stays the module constant (default 10, `process.env.MAX_UPLOAD_MB` override). No `instance_settings` table this phase.
- **`GET /file/*` remains public** (no Cookie header — required because `<img>` tags can't send one).
- **Versions:** `react-filerobot-image-editor@^4.9.1` (the **stable** release, not the `5.0.0-beta`), `react-konva@^19.2.6`, `styled-components@^6.5.3`. The React package is `react-filerobot-image-editor`; the bare `filerobot-image-editor` package now just peers on it.
- **`ImageDto` change is additive only** (add `editedPath`); no field is removed or renamed.
- **Out of scope** (do not build): visual/theme redesign, Tailwind, light-dark toggle, attachment (document) editing, deleting orphaned `original`-derived thumb/edited files, object-detection/"unpack".
- Component name is `FilerobotImageEditor`; `onSave(imageData, designState)` where `imageData` has `canvas`, `imageBase64`, `mimeType`; `onClose(reason, hasChanges)`.

---

### Task 1: Backend — `POST /upload/image/edit` + `ImageDto.editedPath`

**Files:**
- Modify: `apps/api/src/uploads.ts` (add the `/upload/image/edit` route; reuse existing imports `images`, `eq`, `randomUUID`, `mkdir`, `writeFile`, `join`, `dirname`, `sharp`, `itemIdFrom`, `extFromFilename`, `extFromMime`)
- Modify: `apps/api/src/modules/items/service.ts:13` (ImageDto type) and `:69` (the `images.map`)
- Modify: `apps/api/src/modules/items/repo.ts` (items-layer `ImageRow`/`listImages` must carry `editedPath`, else `tsc -b` fails and the DTO is `undefined`)
- Test: `apps/api/test/uploads.test.ts` (add an "image edit" describe block, reusing the existing fixture)

**Interfaces:**
- Consumes: the existing `/upload/image` pipeline, `images` table, `MAX_UPLOAD_MB`, `parseSessionCookie`/`getSessionUser`.
- Produces: `POST /upload/image/edit` (returns the updated image DTO `{ id, originalPath, editedPath, thumbPath, isPrimary }`) and `ImageDto.editedPath` (consumed by the web client in Task 2).

- [ ] **Step 1: Write the failing test**

Extend `apps/api/test/uploads.test.ts` with an "image edit" describe. Reuse the existing `beforeAll` fixture (`app`, `adminCookie`, `itemId`, `png`). Add a helper `uploadImage()` that POSTs `/upload/image` with a fresh file and returns the JSON image row (needs the image `id`, `originalPath`, `thumbPath`, `isPrimary`).

```ts
import sharp from 'sharp'

const uploadImage = async () => {
  const form = new FormData()
  form.append('itemId', String(itemId))
  form.append('file', png, { filename: 'tmp.png', contentType: 'image/png' })
  const res = await app.inject({ method: 'POST', url: '/upload/image', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
  expect(res.statusCode).toBe(200)
  return res.json()
}

describe('image edit', () => {
  it('saves the edited image, regenerates the thumb, and keeps the original', async () => {
    const img = await uploadImage()
    // A different-sized PNG so width/height change proves metadata is re-read.
    const edited = await sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer()

    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', edited, { filename: 'edited.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(200)
    const out = res.json()
    expect(out.editedPath).toMatch(/edited\//)
    expect(out.thumbPath).toMatch(/thumbs\//)
    expect(out.thumbPath).not.toBe(img.thumbPath)  // regenerated to a new file
    expect(out.width).toBe(3)
    expect(out.height).toBe(2)
    expect(out.originalPath).toBe(img.originalPath)  // non-destructive
    expect(out.isPrimary).toBe(img.isPrimary)
  })

  it('rejects unauthenticated requests', async () => {
    const img = await uploadImage()
    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', png, { filename: 'edited.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a bad or unknown imageId', async () => {
    const img = await uploadImage()
    for (const bad of ['abc', '999999']) {
      const form = new FormData()
      form.append('imageId', bad)
      form.append('file', png, { filename: 'edited.png', contentType: 'image/png' })
      const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
      expect([400, 404]).toContain(res.statusCode)
    }
  })

  it('rejects a non-image file', async () => {
    const img = await uploadImage()
    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', Buffer.from('not an image'), { filename: 'x.txt', contentType: 'text/plain' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(400)
  })

  it('rejects a file over the size cap', async () => {
    const img = await uploadImage()
    const big = Buffer.alloc(11 * 1024 * 1024, 1)  // > default 10MB MAX_UPLOAD_MB
    const form = new FormData()
    form.append('imageId', String(img.id))
    form.append('file', big, { filename: 'big.png', contentType: 'image/png' })
    const res = await app.inject({ method: 'POST', url: '/upload/image/edit', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(res.statusCode).toBe(413)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @homebox/api test -t "image edit"`
Expected: FAIL (`POST /upload/image/edit` → 404, route missing).

- [ ] **Step 3: Add the route + narrow the DTO**

In `apps/api/src/uploads.ts`, add inside `registerUploadRoutes` (after the `/upload/image` handler):

```ts
app.post('/upload/image/edit', async (req, reply) => {
  const token = parseSessionCookie(req.headers.cookie)
  const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
  if (!user) return reply.code(401).send({ error: 'UNAUTHORIZED' })

  const part = await req.file()
  if (!part) return reply.code(400).send({ error: 'expected a file part' })

  const imageId = itemIdFrom((part.fields as Record<string, unknown>).imageId)
  if (Number.isNaN(imageId)) return reply.code(400).send({ error: 'invalid imageId' })

  if (typeof part.mimetype !== 'string' || !part.mimetype.startsWith('image/')) {
    return reply.code(400).send({ error: 'file must be an image' })
  }

  const existing = db.select().from(images).where(eq(images.id, imageId)).get()
  if (!existing) return reply.code(404).send({ error: 'image not found' })

  let buffer: Buffer
  try {
    buffer = await part.toBuffer()
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'file too large' })
    }
    throw err
  }
  if (buffer.length > maxUploadBytes) return reply.code(413).send({ error: 'file too large' })

  const metadata = await sharp(buffer).metadata()
  const width = metadata.width ?? null
  const height = metadata.height ?? null

  const uuid = randomUUID()
  const ext = extFromFilename(part.filename) ?? extFromMime(part.mimetype) ?? 'bin'
  const editedRel = `uploads/edited/${uuid}.${ext}`
  const thumbRel = `uploads/thumbs/${uuid}.jpg`

  const editedAbs = join(dataDir, editedRel)
  const thumbAbs = join(dataDir, thumbRel)
  await mkdir(dirname(editedAbs), { recursive: true })
  await writeFile(editedAbs, buffer)
  const thumb = await sharp(buffer).resize({ width: 400 }).jpeg({ quality: 80 }).toBuffer()
  await mkdir(dirname(thumbAbs), { recursive: true })
  await writeFile(thumbAbs, thumb)

  const row = db.update(images).set({
    editedPath: editedRel,
    thumbPath: thumbRel,
    width,
    height,
    format: part.mimetype,
    sizeBytes: buffer.length,
  }).where(eq(images.id, imageId)).returning({
    id: images.id,
    originalPath: images.originalPath,
    editedPath: images.editedPath,
    thumbPath: images.thumbPath,
    isPrimary: images.isPrimary,
    width: images.width,
    height: images.height,
  }).get()

  return reply.code(200).send(row)
})
```

In `apps/api/src/modules/items/service.ts`:
- `ImageDto` (line 13) → `{ id: number; originalPath: string; editedPath: string | null; thumbPath: string; isPrimary: boolean | null }`
- the `images.map` (line 69) → include `editedPath: img.editedPath`:
```ts
images: images.map((img) => ({ id: img.id, originalPath: img.originalPath, editedPath: img.editedPath, thumbPath: img.thumbPath, isPrimary: img.isPrimary })),
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @homebox/api test -t "image edit"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/uploads.ts apps/api/src/modules/items/service.ts apps/api/src/modules/items/repo.ts apps/api/test/uploads.test.ts
git commit -m "feat(upload): non-destructive edit endpoint + ImageDto.editedPath"
```

---

### Task 2: Web — editor dependencies + `PhotoEditor`

**Files:**
- Modify: `apps/web/package.json` (dependencies)
- Create: `apps/web/src/features/upload/PhotoEditor.tsx`
- Modify: `apps/web/src/index.css` (a minimal functional `.photo-editor` overlay rule)
- Test: `apps/web/test/photoEditor.test.tsx`

**Interfaces:**
- Consumes: `ImageDto.editedPath`/`originalPath` (Task 1), `items.list`/`items.get` (already exist), `POST /upload/image/edit` (Task 1).
- Produces: `PhotoEditor` (consumed by `ItemDetail` in Task 3).

- [ ] **Step 1: Add the dependencies**

```bash
pnpm --filter @homebox/web add react-filerobot-image-editor@^4.9.1 react-konva@^19.2.6 styled-components@^6.5.3
```

Verify the web build still typechecks the import path: `pnpm --filter @homebox/web build`.
**Known pitfall:** the editor bundles its own `konva` while `react-konva` peers a different `konva`. If a "duplicate Konva instance" error appears at runtime, pin one `konva`: add a `konva` dependency to `apps/web` (or a `pnpm.overrides` at the workspace root) at the version the editor ships — find it with `pnpm ls konva`. Note it in the build/run output; do not leave the app broken.

- [ ] **Step 2: Add the `PhotoEditor` component**

`apps/web/src/features/upload/PhotoEditor.tsx`:

```tsx
import { useState } from 'react'
import { FilerobotImageEditor } from 'react-filerobot-image-editor'
import { trpc } from '../../api/trpc'

type PhotoEditorProps = { image: { id: number; originalPath: string }; itemId: number; open: boolean; onClose: () => void }
type SaveImageData = { canvas?: HTMLCanvasElement; imageBase64?: string; mimeType?: string }

// Derive a Blob from filerobot's `imageData`. Prefer the canvas (accurate size),
// fall back to decoding the base64 data URL.
const toBlob = (imageData: SaveImageData): Promise<Blob | null> => {
  if (imageData.canvas) {
    return new Promise((resolve) => imageData.canvas!.toBlob((b) => resolve(b), imageData.mimeType ?? 'image/png'))
  }
  if (imageData.imageBase64) {
    const base64 = imageData.imageBase64.split(',')[1] ?? imageData.imageBase64
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return Promise.resolve(new Blob([bytes], { type: imageData.mimeType ?? 'image/png' }))
  }
  return Promise.resolve(null)
}

export function PhotoEditor({ image, itemId, open, onClose }: PhotoEditorProps) {
  const utils = trpc.useUtils()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleSave = async (imageData: SaveImageData) => {
    setSaving(true)
    setError(null)
    try {
      const blob = await toBlob(imageData)
      if (!blob) throw new Error('Editor produced no image')
      const form = new FormData()
      form.append('imageId', String(image.id))
      form.append('file', blob, 'edited.png')
      const res = await fetch('/upload/image/edit', { method: 'POST', body: form, credentials: 'include' })
      if (!res.ok) throw new Error(`Save failed: ${res.status}`)
      await res.json()
      utils.items.list.invalidate()
      utils.items.get.invalidate({ id: itemId })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="photo-editor" role="dialog" aria-modal="true">
      {error && <p role="alert">{error}</p>}
      {saving && <p>Saving…</p>}
      <FilerobotImageEditor source={'/file/' + image.originalPath} onSave={handleSave} onClose={onClose} />
    </div>
  )
}
```

In `apps/web/src/index.css`, add a functional (not decorative) overlay rule:

```css
.photo-editor {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: #000;
}
```

- [ ] **Step 3: Write the test**

`apps/web/test/photoEditor.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

vi.mock('react-filerobot-image-editor', () => ({
  // On mount, invoke onSave with a fake edited image to exercise the submit path.
  FilerobotImageEditor: ({ onSave }: any) => {
    onSave({ canvas: { toBlob: (cb: any) => cb(new Blob(['x'], { type: 'image/png' })) }, mimeType: 'image/png' })
    return null
  },
}))

const invalidateList = vi.fn()
const invalidateGet = vi.fn()
vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ items: { list: { invalidate: invalidateList }, get: { invalidate: invalidateGet } } }),
    },
    __mocks: { invalidateList, invalidateGet },
  }
})

import { PhotoEditor } from '../src/features/upload/PhotoEditor'

describe('PhotoEditor', () => {
  beforeEach(() => { vi.restoreAllMocks(); global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any })

  it('posts the edited blob and invalidates item queries on save', async () => {
    const onClose = vi.fn()
    render(<PhotoEditor image={{ id: 7, originalPath: 'uploads/originals/x.png' }} itemId={3} open onClose={onClose} />)

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/upload/image/edit', expect.objectContaining({ method: 'POST' }))
    })
    await waitFor(() => expect(invalidateList).toHaveBeenCalled())
    await waitFor(() => expect(invalidateGet).toHaveBeenCalledWith({ id: 3 }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @homebox/web test photoEditor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/src/features/upload/PhotoEditor.tsx apps/web/src/index.css apps/web/test/photoEditor.test.tsx
git commit -m "feat(web): filerobot photo editor component"
```

---

### Task 3: Web — `ItemDetail` Edit buttons + edited/original display

**Files:**
- Modify: `apps/web/src/features/items/ItemDetail.tsx`
- Test: `apps/web/test/itemDetail.test.tsx` (new)

**Interfaces:**
- Consumes: `PhotoEditor` (Task 2), `items.get` (exists).
- Produces: the per-photo Edit button and the full-image link.

- [ ] **Step 1: Write the failing test**

`apps/web/test/itemDetail.test.tsx` — `ItemDetail` renders inside a router (uses `useParams`), reads only `trpc.items.get.useQuery`, and renders `PhotoUpload` (which reads `trpc.useUtils`). Mock both the editor and the whole tRPC surface, then wrap in a `MemoryRouter`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('react-filerobot-image-editor', () => ({
  FilerobotImageEditor: () => <div data-testid="fil-editor" />,
}))

vi.mock('../src/api/trpc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/trpc')>()
  const invalidate = vi.fn()
  const item = {
    id: 3, name: 'Lamp', description: 'Desk', quantity: 1, unit: null,
    itemTypeId: 1, locationId: null, type: { id: 1, name: 'Light' }, location: null,
    images: [
      { id: 10, originalPath: 'uploads/originals/a.png', editedPath: 'uploads/edited/e.png', thumbPath: 'uploads/thumbs/a.jpg', isPrimary: true },
      { id: 11, originalPath: 'uploads/originals/b.png', editedPath: null, thumbPath: 'uploads/thumbs/b.jpg', isPrimary: null },
    ],
  }
  return {
    ...actual,
    trpc: {
      Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
      useUtils: () => ({ items: { list: { invalidate }, get: { invalidate } } }),
      items: { get: { useQuery: () => ({ data: item, isLoading: false }) } },
    },
    __item: item,
  }
})

import { ItemDetail } from '../src/features/items/ItemDetail'

describe('item detail photos', () => {
  it('renders an Edit button per image and opens the editor', async () => {
    render(
      <MemoryRouter initialEntries={['/items/3']}>
        <Routes><Route path="/items/:id" element={<ItemDetail />} /></Routes>
      </MemoryRouter>,
    )
    const editButtons = screen.getAllByRole('button', { name: 'Edit' })
    expect(editButtons).toHaveLength(2)
    fireEvent.click(editButtons[0])
    await waitFor(() => expect(screen.getByTestId('fil-editor')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @homebox/web test itemDetail`
Expected: FAIL (`getAllByRole('button', { name: 'Edit' })` finds nothing — no Edit buttons yet).

- [ ] **Step 3: Wire the Edit buttons + editor into `ItemDetail`**

In `apps/web/src/features/items/ItemDetail.tsx`:
- Import `PhotoEditor`.
- Add state: `const [editingImage, setEditingImage] = useState<{ id: number; originalPath: string } | null>(null)`.
- In the images list, per image add an **Edit** button (`setEditingImage({ id: img.id, originalPath: img.originalPath })`) and a "View" link `href={'/file/' + (img.editedPath ?? img.originalPath)}` (target `_blank`).
- Render `<PhotoEditor image={editingImage} itemId={item.id} open={!!editingImage} onClose={() => setEditingImage(null)} />`.

Keep the existing thumbnail `<img src={'/file/' + img.thumbPath}>` (it now reflects the edited image after a save).

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @homebox/web test itemDetail`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/items/ItemDetail.tsx apps/web/test/itemDetail.test.tsx
git commit -m "feat(web): per-photo edit action on item detail"
```

---

### Task 4: E2E upload leg + full verification

**Files:**
- Modify: `apps/web/e2e/catalog.spec.ts`

**Interfaces:**
- Consumes: the built API + SPA served by Fastify on `:3000` (uploads via `/upload/image`).
- Produces: a spec asserting the photo-upload leg of the pipeline renders.

- [ ] **Step 1: Extend the E2E to upload a photo**

After the item is created (the existing test leaves the item on `/items`), add a test that opens the item's detail, uploads a small PNG, and asserts a thumbnail renders. Reuse the known-good 1×1 transparent PNG (`iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`) — the one that actually decodes in `sharp`.

```ts
test('uploads a photo and shows its thumbnail', async ({ page }) => {
  // ...same setup as the main test (setup admin -> login -> seed a type -> create an item)
  await page.click('a:has-text("Lamp")')            // open the created item's detail
  await page.setInputFiles('[aria-label="Upload photo"]', {
    name: 'lamp.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'),
  })
  // After upload the item's get query refetches; the new thumb appears.
  await expect(page.locator('img[src*="/file/uploads/thumbs/"]').first()).toBeVisible()
})
```

- [ ] **Step 2: Run the test, verify it passes**

Run: `pnpm --filter @homebox/web test:e2e`
Expected: PASS.

- [ ] **Step 3: Full verification**

Run: `pnpm -r build` then `pnpm -r test` then `pnpm --filter @homebox/web test:e2e`.
Expected: build clean; all unit suites green; E2E green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/catalog.spec.ts
git commit -m "test(e2e): upload a photo and assert its thumbnail renders"
```

---

## Self-Review

- **Spec coverage:** backend endpoint (T1), `ImageDto.editedPath` (T1), `PhotoEditor` + deps (T2), ItemDetail Edit buttons + edited/original display (T3), test plan incl. E2E upload leg (T4). Non-destructive contract (original preserved, re-edit from original) is asserted in T1's happy-path test. No spec item is left uncovered.
- **Placeholder scan:** no TBD/TODO. Every code step carries concrete code; the konva pitfall is called out explicitly rather than left vague.
- **Type consistency:** `ImageDto.editedPath` is added in T1 and consumed as `img.editedPath` in T3; `ImageDto.originalPath` is used as the editor `source` in T2. `PhotoEditor`'s `itemId` prop (added in the spec review) matches the `items.get` invalidate call. The endpoint's returned DTO shape matches `ImageDto`.
