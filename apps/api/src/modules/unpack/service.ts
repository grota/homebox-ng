import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp, { type Metadata } from 'sharp'
import { renderThumbnail } from '../images/thumbnail.js'
import type { DrizzleDb } from '@homebox/db'
import type { DetectionProviderImpl } from '../detection/provider.js'
import { UnpackError } from './errors.js'
import { createItem } from '../items/repo.js'
import { insertImage } from '../images/repo.js'

export type UnpackContext = { db: DrizzleDb; dataDir: string; userId: number; provider: DetectionProviderImpl }
export type UnpackSource = { image: Buffer; itemTypeId: number }
export type UnpackResult = { detected: number; drafts: { id: number; name: string; imageId: number }[] }

// Write a cropped buffer as original+thumb under `dataDir`. Paths are stored
// RELATIVE (uploads/originals/<uuid>.jpg / uploads/thumbs/<uuid>.jpg) so the
// existing `GET /file/<relpath>` route can serve them.
const saveCrop = async (buffer: Buffer, box: { x: number; y: number; width: number; height: number }, dataDir: string) => {
  const uuid = randomUUID()
  const originalRel = `uploads/originals/${uuid}.jpg`
  const thumbRel = `uploads/thumbs/${uuid}.jpg`
  const base = sharp(buffer).extract({ left: box.x, top: box.y, width: box.width, height: box.height })
  const original = await base.clone().jpeg({ quality: 90 }).toBuffer()
  const thumb = await renderThumbnail(base.clone())
  const meta = await sharp(original).metadata()
  await mkdir(dirname(join(dataDir, originalRel)), { recursive: true })
  await writeFile(join(dataDir, originalRel), original)
  await mkdir(dirname(join(dataDir, thumbRel)), { recursive: true })
  await writeFile(join(dataDir, thumbRel), thumb)
  return { originalRel, thumbRel, sizeBytes: original.length, width: meta.width ?? 0, height: meta.height ?? 0 }
}

export const createItemsFromImage = async (ctx: UnpackContext, source: UnpackSource): Promise<UnpackResult> => {
  const { db, dataDir, userId, provider } = ctx

  // `sharp().metadata()` rejects (rather than returning null dims) for a
  // non-image or truncated file, so surface both cases as the typed error. We
  // rethrow the reject as UnpackError with the original sharp error preserved
  // as `cause` for diagnostics; the null-dims case stays a plain UnpackError.
  //
  // A phone photo usually stores its pixels landscape plus an EXIF tag saying
  // "rotate 90°". The browser honours the tag, so the user (and the manual
  // boxes they draw) see the upright image, while `extract` works on the raw
  // pixels. Baking the rotation in once, up front, puts the provider, the boxes
  // and every crop in the same upright pixel space.
  let buffer = source.image
  let meta: Metadata | null
  try {
    meta = await sharp(buffer).metadata()
    if ((meta.orientation ?? 1) > 1) {
      buffer = await sharp(buffer).autoOrient().toBuffer()
      meta = await sharp(buffer).metadata()
    }
  } catch (err) {
    throw new UnpackError('image-not-decodable', undefined, err)
  }
  if (!meta || !meta.width || !meta.height) throw new UnpackError('image-not-decodable')
  // The provider clamps every box to the bounds we pass here, so each box is
  // guaranteed in-bounds for sharp.extract. We only drop 0-area degenerate
  // boxes (unrelated to clamping).
  const boxes = (await provider.detectBoxes(buffer, { width: meta.width, height: meta.height }))
    .filter((b) => b.box.width > 0 && b.box.height > 0)

  if (boxes.length === 0) return { detected: 0, drafts: [] }

  // Every crop is rendered and written before any row exists, and the rows go in
  // one transaction: a crop that fails (a bad box, a full disk) leaves no draft
  // behind — not even the ones before it — and takes its sibling files with it.
  const crops: Awaited<ReturnType<typeof saveCrop>>[] = []
  try {
    for (const { box } of boxes) crops.push(await saveCrop(buffer, box, dataDir))
  } catch (err) {
    for (const crop of crops) for (const rel of [crop.originalRel, crop.thumbRel]) unlink(join(dataDir, rel)).catch(() => {})
    throw err
  }

  const drafts = db.transaction((tx) =>
    boxes.map((box, i) => {
      const t = tx as unknown as DrizzleDb
      const crop = crops[i]
      const name = box.label?.trim() || `Draft ${i + 1}`
      const item = createItem(t, {
        name,
        description: '',
        quantity: 1,
        unit: null,
        itemTypeId: source.itemTypeId,
        locationId: null,
        createdBy: userId,
        published: false,
        fieldValues: [],
      })
      const image = insertImage(t, {
        itemId: item.id,
        originalPath: crop.originalRel,
        thumbPath: crop.thumbRel,
        format: 'image/jpeg',
        sizeBytes: crop.sizeBytes,
        width: crop.width,
        height: crop.height,
        sortOrder: 1,
        isPrimary: true,
      })
      return { id: item.id, name, imageId: image.id }
    }),
  )
  return { detected: boxes.length, drafts }
}
