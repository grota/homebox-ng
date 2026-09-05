import { eq } from 'drizzle-orm'
import { tags, itemTags } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Row shape surfaced by the app layer. CamelCase object keys (the schema is
// already camelCase on the JS surface). `color` is a nullable column in the
// schema (`text('color')`, no `notNull()`), so the row type mirrors that; the
// service layer passes the `tagInput` default (`#888888`) on create, and DTO
// consumers treat `null` as "no color set".
export type TagRow = { id: number; name: string; color: string | null }

// Select only the DTO columns (never the `createdAt` timestamp).
const TAG_FIELDS = { id: tags.id, name: tags.name, color: tags.color } as const

// All tags, ordered by name ascending.
export const listTags = (db: DrizzleDb): TagRow[] =>
  db.select(TAG_FIELDS).from(tags).orderBy(tags.name).all()

export const getByName = (db: DrizzleDb, name: string): TagRow | undefined =>
  db.select(TAG_FIELDS).from(tags).where(eq(tags.name, name)).get()

export const createTag = (db: DrizzleDb, data: { name: string; color: string | null }): TagRow =>
  db.insert(tags).values({ name: data.name, color: data.color }).returning(TAG_FIELDS).get()

export const deleteTag = (db: DrizzleDb, id: number): boolean =>
  db.delete(tags).where(eq(tags.id, id)).run().changes > 0

// Tags currently assigned to an item (joined through `itemTags`), name-sorted.
export const getItemTagIds = (db: DrizzleDb, itemId: number): TagRow[] =>
  db
    .select(TAG_FIELDS)
    .from(itemTags)
    .innerJoin(tags, eq(itemTags.tagId, tags.id))
    .where(eq(itemTags.itemId, itemId))
    .orderBy(tags.name)
    .all()

// Replace an item's whole tag set: delete the existing `itemTags` rows for
// `itemId`, then insert one row per `tagId`, all in one transaction. Returns
// the resulting full tag list for the item (read back inside `tx` so it's
// consistent with the inserts).
export const replaceItemTags = (db: DrizzleDb, itemId: number, tagIds: number[]): TagRow[] =>
  db.transaction((tx) => {
    tx.delete(itemTags).where(eq(itemTags.itemId, itemId)).run()
    for (const tagId of tagIds) {
      tx.insert(itemTags).values({ itemId, tagId }).run()
    }
    return tx
      .select(TAG_FIELDS)
      .from(itemTags)
      .innerJoin(tags, eq(itemTags.tagId, tags.id))
      .where(eq(itemTags.itemId, itemId))
      .orderBy(tags.name)
      .all()
  })
