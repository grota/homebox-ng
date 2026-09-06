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
