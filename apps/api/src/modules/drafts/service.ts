import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DrizzleDb } from '@homebox/db'
import { TRPCError } from '@trpc/server'
import * as itemsService from '../items/service.js'
import * as itemsRepo from '../items/repo.js'
import { getImagesForItem } from '../images/repo.js'
import type { ItemDto } from '../items/service.js'

export const listDrafts = (db: DrizzleDb): ItemDto[] => itemsService.hydrateRows(db, itemsRepo.listDraftItems(db))

export const renameDraft = (db: DrizzleDb, id: number, name: string): ItemDto =>
  itemsService.updateItem(db, { id, name })

export const publishDraft = (db: DrizzleDb, id: number): void => {
  if (!itemsRepo.setItemPublished(db, id, true)) throw new TRPCError({ code: 'NOT_FOUND' })
}

export const publishAll = (db: DrizzleDb, ids?: number[]): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listDraftItems(db).map((r) => r.id)
  for (const id of targets) itemsRepo.setItemPublished(db, id, true)
}

// Bulk discard, mirroring `publishAll`: an omitted or empty `ids` means every
// draft.
//
// The batch is a loop of independent single-row deletes with no surrounding
// transaction, and `deleteItem` THROWS `NOT_FOUND` for a row that is already
// gone (which is why `discardDraft`'s `if (!deleted.ok)` branch never runs).
// Letting that throw escape would leave the batch half-applied: the drafts
// before it deleted, the ones after it untouched, no rollback. A row that no
// longer exists is already the outcome this loop wanted for it, so skip it.
// `better-sqlite3` is synchronous, so nothing can delete the row between this
// check and `deleteItem`'s own existence check.
export const discardAll = (db: DrizzleDb, ids: number[] | undefined, dataDir: string): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listDraftItems(db).map((r) => r.id)
  for (const id of targets) {
    if (!itemsRepo.getItem(db, id)) continue
    discardDraft(db, id, dataDir)
  }
}

// Delete the draft item row (cascade removes its images + custom fields + tags,
// and FTS) and best-effort remove the orphaned image files on disk.
export const discardDraft = (db: DrizzleDb, id: number, dataDir: string): boolean => {
  const images = getImagesForItem(db, id)
  const deleted = itemsService.deleteItem(db, id) // reindexes + returns { ok: true }
  if (!deleted.ok) return false
  for (const image of images) {
    for (const rel of [image.originalPath, image.editedPath, image.thumbPath]) {
      if (!rel) continue
      unlink(join(dataDir, rel)).catch(() => {}) // best-effort; DB cascade keeps consistency
    }
  }
  return true
}
