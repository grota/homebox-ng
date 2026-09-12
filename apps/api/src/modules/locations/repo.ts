import { eq, sql } from 'drizzle-orm'
import { locations } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Row shape surfaced by the app layer. CamelCase object keys (the schema is
// already camelCase on the JS surface). `description` is nullable in the DB.
export type LocationRow = {
  id: number
  parentId: number | null
  name: string
  description: string | null
}

// Select only the DTO columns (never timestamps).
const ROW_FIELDS = { id: locations.id, parentId: locations.parentId, name: locations.name, description: locations.description } as const

export const listLocations = (db: DrizzleDb): LocationRow[] => db.select(ROW_FIELDS).from(locations).all()

export const getLocation = (db: DrizzleDb, id: number): LocationRow | undefined =>
  db.select(ROW_FIELDS).from(locations).where(eq(locations.id, id)).get()

export type CreateLocationData = { name: string; parentId: number | null; description: string | null }

export const createLocation = (db: DrizzleDb, data: CreateLocationData): LocationRow =>
  db.insert(locations).values(data).returning(ROW_FIELDS).get()

export type UpdateLocationData = Partial<Pick<CreateLocationData, 'name' | 'parentId' | 'description'>>

export const updateLocation = (db: DrizzleDb, id: number, data: UpdateLocationData): LocationRow =>
  db.update(locations).set(data).where(eq(locations.id, id)).returning(ROW_FIELDS).get()

export const deleteLocation = (db: DrizzleDb, id: number): boolean =>
  db.delete(locations).where(eq(locations.id, id)).run().changes > 0

// ---------------------------------------------------------------------------
// Subtree reads, for the deep delete. Each walks descendants via a recursive
// CTE seeded at `rootId`. `UNION` (distinct) rather than `UNION ALL` so a
// cyclic `parent_id` chain terminates: once a node is already in the set no new
// row is produced and the recursion stops.
// ---------------------------------------------------------------------------

// Every location id in the subtree, `rootId` included.
export const listSubtreeIds = (db: DrizzleDb, rootId: number): number[] =>
  db.all<{ id: number }>(sql`
    WITH RECURSIVE sub(id) AS (
      SELECT ${rootId}
      UNION
      SELECT l.id FROM locations l JOIN sub ON l.parent_id = sub.id
    )
    SELECT id FROM sub
  `).map((r) => r.id)

// Ids of the items that live in any location of the subtree.
export const listSubtreeItemIds = (db: DrizzleDb, rootId: number): number[] =>
  db.all<{ id: number }>(sql`
    WITH RECURSIVE sub(id) AS (
      SELECT ${rootId}
      UNION
      SELECT l.id FROM locations l JOIN sub ON l.parent_id = sub.id
    )
    SELECT i.id FROM items i JOIN sub ON i.location_id = sub.id
  `).map((r) => r.id)

// Disk paths (`originalPath`, `editedPath`, `thumbPath`) of the images owned by
// the subtree's items. The delete cascades the `images` rows away with their
// items, so these must be read BEFORE the delete — afterwards nothing on the DB
// side names the files any more.
export const listSubtreeImagePaths = (db: DrizzleDb, rootId: number): string[] =>
  db.all<{ path: string }>(sql`
    WITH RECURSIVE sub(id) AS (
      SELECT ${rootId}
      UNION
      SELECT l.id FROM locations l JOIN sub ON l.parent_id = sub.id
    )
    SELECT im.original_path AS path FROM images im JOIN items i ON i.id = im.item_id JOIN sub ON i.location_id = sub.id
    UNION ALL
    SELECT im.edited_path FROM images im JOIN items i ON i.id = im.item_id JOIN sub ON i.location_id = sub.id WHERE im.edited_path IS NOT NULL
    UNION ALL
    SELECT im.thumb_path FROM images im JOIN items i ON i.id = im.item_id JOIN sub ON i.location_id = sub.id
  `).map((r) => r.path)
