import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { eq } from 'drizzle-orm'
import { images, type DrizzleDb } from '@homebox/db'
import { renderThumbnail } from './thumbnail.js'

export type SkippedThumbnail = { path: string; reason: string }
export type RegenerateResult = { total: number; rewritten: number; resized: number; skipped: SkippedThumbnail[] }

// Write via a temp name and rename into place: a rename is atomic, so a backup
// copying `uploads/` at the same moment sees the old thumbnail or the new one,
// never half of one.
const writeAtomically = async (dest: string, data: Buffer): Promise<void> => {
  const tmp = `${dest}.tmp-${process.pid}`
  try {
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(tmp, data)
    await rename(tmp, dest)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

const reasonFor = (err: unknown): string =>
  (err as { code?: string })?.code === 'ENOENT' ? 'file missing' : (err as Error)?.message ?? String(err)

/**
 * Re-render every stored thumbnail, in place, under the rule in `thumbnail.ts`.
 *
 * The source is the photo as displayed — the edit when there is one, else the
 * original — which is what the edit route renders a thumb from; rendering an
 * edited photo's thumb from its original would undo the edit on every card. The
 * source is only ever read, and the thumb is rendered from it rather than from
 * the old thumb, so nothing degrades across runs and a second run writes the same
 * bytes as the first.
 *
 * The same pass corrects the stored `width`/`height` to the displayed size: rows
 * written before uploads honoured EXIF orientation hold a rotated phone photo's
 * raw (sideways) size.
 *
 * One photo at a time, deliberately: nobody waits on this, and a small home
 * server stays responsive while it runs. One unreadable photo never stops the
 * rest; it is reported in `skipped`.
 */
export const regenerateThumbnails = async (
  db: DrizzleDb,
  dataDir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<RegenerateResult> => {
  const rows = db
    .select({ id: images.id, originalPath: images.originalPath, editedPath: images.editedPath, thumbPath: images.thumbPath, width: images.width, height: images.height })
    .from(images)
    .all()
  const result: RegenerateResult = { total: rows.length, rewritten: 0, resized: 0, skipped: [] }
  onProgress?.(0, rows.length)

  for (const [i, row] of rows.entries()) {
    const sourcePath = row.editedPath ?? row.originalPath
    try {
      const source = await readFile(join(dataDir, sourcePath))
      const { width, height } = (await sharp(source).metadata()).autoOrient
      await writeAtomically(join(dataDir, row.thumbPath), await renderThumbnail(source))
      result.rewritten++
      if (width !== row.width || height !== row.height) {
        db.update(images).set({ width, height }).where(eq(images.id, row.id)).run()
        result.resized++
      }
    } catch (err) {
      result.skipped.push({ path: sourcePath, reason: reasonFor(err) })
    }
    onProgress?.(i + 1, rows.length)
  }
  return result
}
