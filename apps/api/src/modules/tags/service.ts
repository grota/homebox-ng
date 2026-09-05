import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
import { itemTags } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { TagInput } from '@homebox/shared'
import { reindexItem } from '../items/fts.js'
import * as repo from './repo.js'
import type { TagRow } from './repo.js'

// `tagDto = { id, name, color }` (see task-10 brief PRODUCES bullet). `color`
// is nullable in the schema, so the DTO mirrors that (`null`/string).
export type TagDto = { id: number; name: string; color: string | null }

const toDto = (row: TagRow): TagDto => ({ id: row.id, name: row.name, color: row.color })

export const listTags = (db: DrizzleDb): TagDto[] => repo.listTags(db).map(toDto)

// `create` upserts by name: if a tag with `input.name` already exists, return
// it unchanged; otherwise insert a new row and return it.
export const createTag = (db: DrizzleDb, input: TagInput): TagDto => {
  const existing = repo.getByName(db, input.name)
  if (existing) return toDto(existing)
  return toDto(repo.createTag(db, { name: input.name, color: input.color }))
}

// `assign` runs replace semantics: drop the item's existing tag links, then
// re-establish one row per `tagId`, all in a single transaction. The FTS reindex
// runs INSIDE the same transaction, so the tag link rewrite and the searchable
// blob commit atomically. Returns the resulting full tag list for the item as
// `{ assigned }`.
export const assignTags = (db: DrizzleDb, input: { itemId: number; tagIds: number[] }): { assigned: TagDto[] } => {
  const rows = db.transaction((tx) => {
    const assigned = repo.replaceItemTags(tx as unknown as DrizzleDb, input.itemId, input.tagIds)
    reindexItem(tx as unknown as DrizzleDb, input.itemId)
    return assigned
  })
  return { assigned: rows.map(toDto) }
}

// `delete` removes the tag row; the `itemTags.tagId` FK cascades, so any
// associated item links are cleaned up automatically. Capture the referencing
// item ids BEFORE the delete (the cascade wipes the `itemTags` rows), then
// reindex each so the FTS `tags` blob no longer carries the deleted tag's name.
export const deleteTag = (db: DrizzleDb, id: number): { ok: true } => {
  const itemIds = db.select({ itemId: itemTags.itemId }).from(itemTags).where(eq(itemTags.tagId, id)).all().map((r) => r.itemId)
  if (!repo.deleteTag(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  for (const itemId of itemIds) reindexItem(db, itemId)
  return { ok: true }
}
