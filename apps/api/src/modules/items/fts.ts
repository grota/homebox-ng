import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { items, itemTags, tags, itemCustomFieldValues, itemTypes, locations, itemsFts } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Full-text search index. The searchable blob is denormalized into the FTS5
// `items_fts` virtual table and kept in sync here at the application layer
// (not via SQL triggers). Each `reindex*` walks the joined source rows and
// recomputes the item's blob; `rebuildFTS` wipes and repopulates the whole
// index for the admin/dev repair path.

// Space-joined ancestor location names and descriptions, root → leaf, so a
// query naming any ancestor in the path matches the item. The design permits
// cyclic `parent_id` chains, so guard against revisiting a node (check BEFORE
// adding its name so a cycle's repeated node is not duplicated in the blob).
const locationPathNames = (db: DrizzleDb, locationId: number): string => {
  const chain: string[] = []
  const seen = new Set<number>()
  let id = locationId
  let cur: { parentId: number | null; name: string; description: string | null } | undefined = db
    .select({ parentId: locations.parentId, name: locations.name, description: locations.description })
    .from(locations)
    .where(eq(locations.id, id))
    .get()
  while (cur) {
    if (seen.has(id)) break // already visited → cyclic; stop without duplicating
    seen.add(id)
    chain.unshift(cur.description ? `${cur.name} ${cur.description}` : cur.name)
    if (cur.parentId == null) break
    id = cur.parentId
    cur = db
      .select({ parentId: locations.parentId, name: locations.name, description: locations.description })
      .from(locations)
      .where(eq(locations.id, id))
      .get()
  }
  return chain.join(' ')
}

type ItemSearchBlob = {
  name: string
  description: string
  tags: string
  customFields: string
  typeName: string
  locationPath: string
}

// Recompute the searchable blob for a single item. Returns null when the item
// no longer exists — or is in the trash, which is indexed the same way as
// absent: `reindexItem` then clears any stale row, so a trashed item is not
// searchable and cannot be resurrected into results by a reindex.
const computeBlob = (db: DrizzleDb, itemId: number): ItemSearchBlob | null => {
  const item = db
    .select({
      name: items.name,
      description: items.description,
      itemTypeId: items.itemTypeId,
      locationId: items.locationId,
      trashedAt: items.trashedAt,
    })
    .from(items)
    .where(eq(items.id, itemId))
    .get()
  if (!item || item.trashedAt != null) return null

  const tagNames = db
    .select({ name: tags.name })
    .from(itemTags)
    .innerJoin(tags, eq(itemTags.tagId, tags.id))
    .where(eq(itemTags.itemId, itemId))
    .all()
    .map((r) => r.name)

  const customValues = db
    .select({ value: itemCustomFieldValues.value })
    .from(itemCustomFieldValues)
    .where(and(eq(itemCustomFieldValues.itemId, itemId), isNotNull(itemCustomFieldValues.value)))
    .all()
    .map((r) => r.value as string)

  const typeName =
    item.itemTypeId != null
      ? db.select({ name: itemTypes.name }).from(itemTypes).where(eq(itemTypes.id, item.itemTypeId)).get()?.name ?? ''
      : ''

  return {
    name: item.name,
    description: item.description,
    tags: tagNames.join(' '),
    customFields: customValues.join(' '),
    typeName,
    locationPath: item.locationId != null ? locationPathNames(db, item.locationId) : '',
  }
}

// Delete-then-insert (not an update) so stale nested content can never linger.
export const reindexItem = (db: DrizzleDb, itemId: number): void => {
  const blob = computeBlob(db, itemId)
  db.delete(itemsFts).where(eq(itemsFts.itemId, itemId)).run()
  if (blob) {
    db.insert(itemsFts).values({ itemId, ...blob }).run()
  }
}

// A type rename changes every item that references it.
export const reindexItemType = (db: DrizzleDb, itemTypeId: number): void => {
  const ids = db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.itemTypeId, itemTypeId))
    .all()
    .map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}

// A location rename (or move) changes the `location_path` of every item in its
// subtree, so walk descendants via a recursive CTE. `UNION` (distinct) rather
// than `UNION ALL` so a cyclic `parent_id` chain terminates: once a node is
// already in the set no new row is produced and the recursion stops.
export const reindexLocationSubtree = (db: DrizzleDb, locationId: number): void => {
  const ids = db
    .all<{ id: number }>(sql`
      WITH RECURSIVE sub(id) AS (
        SELECT ${locationId}
        UNION
        SELECT l.id FROM locations l JOIN sub ON l.parent_id = sub.id
      )
      SELECT i.id FROM items i JOIN sub ON i.location_id = sub.id
    `)
    .map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}

// Wipe and re-insert the whole index from scratch. Trashed items are skipped —
// the point of the reindex is to restore *searchable* content, and a trashed item
// is not searchable. Skipping here rather than relying on `computeBlob` alone
// keeps the count this returns honest about what it did.
export const rebuildFTS = (db: DrizzleDb): void => {
  db.run(sql`DELETE FROM items_fts`)
  const ids = db
    .select({ id: items.id })
    .from(items)
    .where(isNull(items.trashedAt))
    .all()
    .map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}
