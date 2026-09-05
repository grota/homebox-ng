import { and, eq, sql } from 'drizzle-orm'
import { items, itemTags, tags, itemCustomFieldValues, itemTypes, locations, itemsFts } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

// Full-text search index. The searchable blob is denormalized into the FTS5
// `items_fts` virtual table and kept in sync here at the application layer
// (not via SQL triggers). Each `reindex*` walks the joined source rows and
// recomputes the item's blob; `rebuildFTS` wipes and repopulates the whole
// index for the admin/dev repair path.

// Space-joined ancestor location names, root → leaf, so a query naming any
// ancestor in the path matches the item. Guards against cycles via `seen`.
const locationPathNames = (db: DrizzleDb, locationId: number): string => {
  const chain: string[] = []
  const seen = new Set<number>()
  let id = locationId
  let cur: { parentId: number | null; name: string } | undefined = db
    .select({ parentId: locations.parentId, name: locations.name })
    .from(locations)
    .where(eq(locations.id, id))
    .get()
  while (cur) {
    chain.unshift(cur.name)
    if (cur.parentId == null || seen.has(cur.parentId)) break
    seen.add(cur.parentId)
    id = cur.parentId
    cur = db
      .select({ parentId: locations.parentId, name: locations.name })
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
// no longer exists, so `reindexItem` can clear any stale row.
const computeBlob = (db: DrizzleDb, itemId: number): ItemSearchBlob | null => {
  const item = db
    .select({
      name: items.name,
      description: items.description,
      itemTypeId: items.itemTypeId,
      locationId: items.locationId,
    })
    .from(items)
    .where(eq(items.id, itemId))
    .get()
  if (!item) return null

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
    .where(and(eq(itemCustomFieldValues.itemId, itemId), sql`${itemCustomFieldValues.value} IS NOT NULL`))
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
// subtree, so walk descendants via a recursive CTE.
export const reindexLocationSubtree = (db: DrizzleDb, locationId: number): void => {
  const ids = db
    .all<{ id: number }>(sql`
      WITH RECURSIVE sub(id) AS (
        SELECT ${locationId}
        UNION ALL
        SELECT l.id FROM locations l JOIN sub ON l.parent_id = sub.id
      )
      SELECT i.id FROM items i JOIN sub ON i.location_id = sub.id
    `)
    .map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}

// Wipe and re-insert the whole index from scratch.
export const rebuildFTS = (db: DrizzleDb): void => {
  db.run(sql`DELETE FROM items_fts`)
  const ids = db
    .select({ id: items.id })
    .from(items)
    .all()
    .map((r) => r.id)
  for (const id of ids) reindexItem(db, id)
}
