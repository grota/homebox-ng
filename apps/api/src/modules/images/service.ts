import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import * as repo from './repo.js'
import type { ImageRow } from './repo.js'

export const listForItem = (db: DrizzleDb, itemId: number): ImageRow[] => repo.getImagesForItem(db, itemId)

// Mark an image as the primary for its item. The image must belong to the item
// (otherwise `NOT_FOUND`), and the row is re-read after the update so callers
// see the refreshed `isPrimary`.
export const setPrimary = (db: DrizzleDb, itemId: number, imageId: number): ImageRow => {
  const existing = repo.getImage(db, imageId)
  if (!existing || existing.itemId !== itemId) throw new TRPCError({ code: 'NOT_FOUND' })
  repo.setImagePrimary(db, itemId, imageId)
  return repo.getImage(db, imageId)!
}

// A photo is not an item, so it is not trashable — deleting one is permanent.
// It does have to take its files with it, though: this used to drop the row and
// leave the original, the edited copy and the thumbnail orphaned on disk, which
// made the item page's "Delete photo" a lie about half its job.
export const deleteImage = (db: DrizzleDb, id: number, dataDir: string): { ok: true } => {
  // Read before the delete: afterwards nothing on the DB side names the files.
  const image = repo.getImage(db, id)
  if (!image || !repo.deleteImage(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  for (const rel of [image.originalPath, image.editedPath, image.thumbPath]) {
    if (!rel) continue
    unlink(join(dataDir, rel)).catch(() => {}) // best-effort; the row is already gone
  }
  return { ok: true }
}
