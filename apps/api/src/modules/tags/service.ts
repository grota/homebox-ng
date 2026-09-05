import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import type { TagInput } from '@homebox/shared'
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
// re-establish one row per `tagId`, all in a single transaction. Returns the
// resulting full tag list for the item as `{ assigned }`.
export const assignTags = (db: DrizzleDb, input: { itemId: number; tagIds: number[] }): { assigned: TagDto[] } => ({
  assigned: repo.replaceItemTags(db, input.itemId, input.tagIds).map(toDto),
})

// `delete` removes the tag row; the `itemTags.tagId` FK cascades, so any
// associated item links are cleaned up automatically.
export const deleteTag = (db: DrizzleDb, id: number): { ok: true } => {
  if (!repo.deleteTag(db, id)) throw new TRPCError({ code: 'NOT_FOUND' })
  return { ok: true }
}
