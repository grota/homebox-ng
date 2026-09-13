import type { DrizzleDb } from '@homebox/db'
import { TRPCError } from '@trpc/server'
import * as itemsService from '../items/service.js'
import * as itemsRepo from '../items/repo.js'
import * as trashService from '../trash/service.js'
import type { ItemDto } from '../items/service.js'

// One page of drafts plus the unpaginated total, mirroring `items.list`'s
// `{ items, total }` so the two pages share one pagination convention.
export const listDrafts = (db: DrizzleDb, page = 1, pageSize = 20): { items: ItemDto[]; total: number } => ({
  items: itemsService.hydrateRows(db, itemsRepo.listDraftItems(db, itemsRepo.pageWindow(page, pageSize))),
  total: itemsRepo.countDraftItems(db),
})

export const renameDraft = (db: DrizzleDb, id: number, name: string): ItemDto =>
  itemsService.updateItem(db, { id, name })

export const publishDraft = (db: DrizzleDb, id: number): void => {
  if (!itemsRepo.setItemPublished(db, id, true)) throw new TRPCError({ code: 'NOT_FOUND' })
}

export const publishAll = (db: DrizzleDb, ids?: number[]): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listAllDraftIds(db)
  for (const id of targets) itemsRepo.setItemPublished(db, id, true)
}

// A draft is trashed exactly as an item is — same row, same flag — so these
// delegate rather than reimplement. Discarding used to delete the row and unlink
// its photos; it is now recoverable, and the files survive until the trash is
// purged (ADR-0004).
export const trashDraft = (db: DrizzleDb, id: number): void => trashService.trashItem(db, id)

// Bulk trash, mirroring `publishAll`: an omitted or empty `ids` means every draft.
//
// The batch is a loop of independent single-row updates with no surrounding
// transaction, and `trashItem` THROWS `NOT_FOUND` for a row that is already gone.
// Letting that throw escape would leave the batch half-applied: the drafts before
// it trashed, the ones after it untouched, no rollback. A row that no longer
// exists is already the outcome this loop wanted for it, so skip it.
// `better-sqlite3` is synchronous, so nothing can remove the row between this
// check and the update.
export const trashAll = (db: DrizzleDb, ids: number[] | undefined): void => {
  const targets = ids && ids.length > 0 ? ids : itemsRepo.listAllDraftIds(db)
  for (const id of targets) {
    if (!itemsRepo.getItem(db, id)) continue
    trashDraft(db, id)
  }
}
