import { TRPCError } from '@trpc/server'
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

// Rename and/or recolor a tag. Unlike `create` (an upsert keyed on the name),
// this targets a specific tag by id, and rejects a rename onto another tag's
// name with `CONFLICT` rather than letting the UNIQUE constraint surface as a
// 500. A rename changes the FTS `tags` blob of every item carrying the tag, so
// those items are re-indexed after the write.
export const updateTag = (db: DrizzleDb, input: { id: number; name?: string; color?: string | null }): TagDto => {
  const existing = repo.getById(db, input.id)
  if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })

  if (input.name !== undefined) {
    const clash = repo.getByName(db, input.name)
    if (clash && clash.id !== input.id) throw new TRPCError({ code: 'CONFLICT' })
  }

  const data: repo.UpdateTagData = {}
  if (input.name !== undefined) data.name = input.name
  if (input.color !== undefined) data.color = input.color

  if (Object.keys(data).length === 0) return toDto(existing)

  // Captured before the write; the links themselves do not change, but the
  // names the blobs are built from do.
  const itemIds = input.name !== undefined ? repo.listItemIdsForTag(db, input.id) : []
  const row = repo.updateTag(db, input.id, data)
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' })

  for (const itemId of itemIds) reindexItem(db, itemId)
  return toDto(row)
}

// `delete` removes the tag row; the `itemTags.tagId` FK cascades, so any
// associated item links are cleaned up automatically. Capture the referencing
// item ids BEFORE the delete (the cascade wipes the `itemTags` rows), then
// reindex each so the FTS `tags` blob no longer carries the deleted tag's name.
export const deleteTag = (db: DrizzleDb, id: number): { ok: true } => {
  const itemIds = repo.listItemIdsForTag(db, id)
  if (!repo.deleteTag(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  for (const itemId of itemIds) reindexItem(db, itemId)
  return { ok: true }
}
