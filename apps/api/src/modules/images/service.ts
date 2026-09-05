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

export const deleteImage = (db: DrizzleDb, id: number): { ok: true } => {
  if (!repo.deleteImage(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  return { ok: true }
}
