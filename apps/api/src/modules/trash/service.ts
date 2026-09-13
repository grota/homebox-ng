import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DrizzleDb } from '@homebox/db'
import { TRPCError } from '@trpc/server'
import * as itemsService from '../items/service.js'
import * as itemsRepo from '../items/repo.js'
import { reindexItem } from '../items/fts.js'
import { getImagesForItem } from '../images/repo.js'
import type { ItemDto } from '../items/service.js'

// The trash (ADR-0004). Items and drafts are the same row, so this is one
// mechanism for both; `published` is what distinguishes them and is never
// touched here, because that is what makes restore return a thing to where it
// came from.

// One page plus the total, the same shape `drafts.list` and `items.list` return,
// so the trash page reuses their control rather than inventing one.
export const listTrash = (db: DrizzleDb, page = 1, pageSize = 20): { items: ItemDto[]; total: number } => ({
  items: itemsService.hydrateRows(db, itemsRepo.listTrashedItems(db, itemsRepo.pageWindow(page, pageSize))),
  total: itemsRepo.countTrashedItems(db),
})

// Both directions reindex. `computeBlob` returns null for a trashed item, so
// `reindexItem` clears its search row on the way in and repopulates it on the
// way out — without this, a trashed item would stay searchable until the next
// full rebuild, which is exactly the bug the guard sweep exists to prevent.
export const trashItem = (db: DrizzleDb, id: number): void => {
  if (!itemsRepo.setItemTrashedAt(db, id, new Date())) throw new TRPCError({ code: 'NOT_FOUND' })
  reindexItem(db, id)
}

// Restoring something that is not in the trash is a caller error rather than a
// no-op: it would silently "succeed" while restoring a different item's intent.
export const restoreItem = (db: DrizzleDb, id: number): ItemDto => {
  const row = itemsRepo.getItem(db, id)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })
  if (row.trashedAt == null) throw new TRPCError({ code: 'BAD_REQUEST', message: 'item is not in the trash' })
  itemsRepo.setItemTrashedAt(db, id, null)
  reindexItem(db, id)
  return itemsService.hydrateRows(db, [itemsRepo.getItem(db, id)!])[0]
}

// The only operation in the codebase that destroys an item's photos. The row
// delete cascades to images/fields/tags and reindexes; the files are unlinked
// best-effort afterwards, because the DB is already consistent without them.
export const purgeItem = (db: DrizzleDb, id: number, dataDir: string): boolean => {
  const images = getImagesForItem(db, id)
  const deleted = itemsService.deleteItem(db, id) // throws NOT_FOUND; reindexes
  if (!deleted.ok) return false
  for (const image of images) {
    for (const rel of [image.originalPath, image.editedPath, image.thumbPath]) {
      if (!rel) continue
      unlink(join(dataDir, rel)).catch(() => {})
    }
  }
  return true
}

// Bulk purge, mirroring the bulk operations it replaces: an omitted or empty
// `ids` means the whole trash.
//
// A loop of independent single-row deletes with no surrounding transaction, and
// `deleteItem` THROWS `NOT_FOUND` for a row that is already gone. Letting that
// escape would leave the batch half-applied — the items before it purged, the
// ones after it untouched, no rollback. A row that no longer exists is already
// the outcome this loop wanted for it, so skip it. `better-sqlite3` is
// synchronous, so nothing can purge the row between the check and the delete.
export const purgeAll = (db: DrizzleDb, ids: number[] | undefined, dataDir: string): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listAllTrashedIds(db)
  for (const id of targets) {
    if (!itemsRepo.getItem(db, id)) continue
    purgeItem(db, id, dataDir)
  }
}
