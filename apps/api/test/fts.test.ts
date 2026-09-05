import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, runMigrations } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { reindexItem, reindexItemType, reindexLocationSubtree, rebuildFTS } from '../src/modules/items/fts'
import { createItem, deleteItem } from '../src/modules/items/repo'
import { updateItem } from '../src/modules/items/service'
import { createType } from '../src/modules/itemTypes/repo'
import { createLocation, updateLocation } from '../src/modules/locations/repo'
import { createTag, replaceItemTags } from '../src/modules/tags/repo'
import { createUser } from '../src/modules/users/repo'

let db: DrizzleDb
let adminUserId: number

// Monotonic counter keeps default type/tag names unique (both have a `unique`
// column), so seeding many items never collides on the shared defaults.
let seq = 0
const uniqueName = (base: string) => `${base}-${++seq}`

type SeedItemOptions = {
  name: string
  description?: string
  typeName?: string
  fieldValue?: string
  tagName?: string
  locationName?: string
  parentLocationName?: string
}

type SeedItemResult = {
  itemId: number
  typeId: number
  locationId: number
  childLocationId: number
  tagId: number
  fieldId: number | null
}

// Seed an item type (with a custom field when `fieldValue` is given), a
// location chain (root + child, so the location-path blob has >1 level), a tag,
// and the item itself (via repo.createItem, which accepts fieldValues). The tag
// is assigned to the item. Everything is created through the existing repo
// functions.
const seedItem = (opts: SeedItemOptions): SeedItemResult => {
  const type = createType(db, {
    name: opts.typeName ?? uniqueName('Gear'),
    description: null,
    fields:
      opts.fieldValue != null
        ? [{ name: 'detail', fieldType: 'text', required: false, config: null, sortOrder: 0 }]
        : [],
  })
  const location = createLocation(db, { name: opts.parentLocationName ?? 'Home', parentId: null, description: null })
  const child = createLocation(db, { name: opts.locationName ?? 'Shelf', parentId: location.id, description: null })
  const tag = createTag(db, { name: opts.tagName ?? uniqueName('misc'), color: '#888888' })
  const item = createItem(db, {
    name: opts.name,
    description: opts.description ?? '',
    quantity: 1,
    unit: null,
    itemTypeId: type.id,
    locationId: child.id,
    createdBy: adminUserId,
    published: true,
    fieldValues: opts.fieldValue != null ? [{ fieldId: type.fields[0].id, value: opts.fieldValue }] : [],
  })
  replaceItemTags(db, item.id, [tag.id])
  return {
    itemId: item.id,
    typeId: type.id,
    locationId: location.id,
    childLocationId: child.id,
    tagId: tag.id,
    fieldId: type.fields[0]?.id ?? null,
  }
}

// Run an FTS MATCH and return the matching item_ids. Term is a bound parameter
// (injection-safe strings are fine as FTS query text).
const match = (term: string): number[] =>
  db.all<{ item_id: number }>(sql`SELECT item_id FROM items_fts WHERE items_fts MATCH ${term}`).map((r) => r.item_id)

// Count rows in the index for a given item (used to assert delete-removes-row).
const ftsRowsFor = (itemId: number): number =>
  db.all<{ item_id: number }>(sql`SELECT item_id FROM items_fts WHERE item_id = ${itemId}`).length

beforeAll(() => {
  db = createDb(':memory:')
  runMigrations(db)
  const user = createUser(db, { name: 'Seeder', email: 'seeder@test.co', passwordHash: 'x', role: 'admin' })
  adminUserId = user.id
})

describe('fts reindex', () => {
  it('indexes the searchable blob and matches case- and diacritic-insensitively', () => {
    const lamp = seedItem({ name: 'Desk Lamp', description: 'a wood desk lamp' })
    const cafe = seedItem({ name: 'Café Table', description: 'a bistro table' })
    reindexItem(db, lamp.itemId)
    reindexItem(db, cafe.itemId)

    expect(match('lamp')).toEqual([lamp.itemId]) // name + description
    expect(match('LAMP')).toEqual([lamp.itemId]) // case-insensitive
    expect(match('cafe')).toEqual([cafe.itemId]) // diacritic-insensitive (café)
    expect(match('CAFÉ')).toEqual([cafe.itemId])
  })

  it('matches terms from tags, custom-field values, the type name, and a location in the path', () => {
    const tagged = seedItem({ name: 'Chair', tagName: 'fragile' })
    const custom = seedItem({ name: 'Sofa', fieldValue: 'velvet' })
    const typed = seedItem({ name: 'Stool', typeName: 'Oak' })
    const located = seedItem({ name: 'Table', parentLocationName: 'Garage' })
    for (const s of [tagged, custom, typed, located]) reindexItem(db, s.itemId)

    expect(match('fragile')).toEqual([tagged.itemId]) // only in the tag name
    expect(match('velvet')).toEqual([custom.itemId]) // only in a custom-field value
    expect(match('oak')).toEqual([typed.itemId]) // only in the type name
    expect(match('garage')).toEqual([located.itemId]) // only an ancestor location name
  })

  it('matching a term in a child location name also returns the item', () => {
    const { itemId } = seedItem({ name: 'Drawer', locationName: 'Bedroom' })
    reindexItem(db, itemId)
    expect(match('bedroom')).toEqual([itemId])
  })

  it('reindexItemType and reindexLocationSubtree reindex exactly their items', () => {
    const a = seedItem({ name: 'A', typeName: 'Acme', parentLocationName: 'Warehouse' })
    const b = seedItem({ name: 'B' })
    // A lives in the 'Warehouse' subtree; B does not.
    reindexLocationSubtree(db, a.locationId)
    expect(match('warehouse')).toEqual([a.itemId])
    // Only A has the 'Acme' type.
    reindexItemType(db, a.typeId)
    expect(match('acme')).toEqual([a.itemId])
    // B stays out of both narrow reindexes.
    expect(match('warehouse')).not.toContain(b.itemId)
  })

  it('terminates and matches both parent names when location data is cyclic', () => {
    // Build a 2-cycle: locA.parent_id = locB and locB.parent_id = locA. The
    // design permits cyclic parent chains, so both the ancestor walk
    // (locationPathNames) and the subtree CTE (reindexLocationSubtree) must
    // terminate — completing this test is the core assertion.
    const locA = createLocation(db, { name: 'Cyclone', parentId: null, description: null })
    const locB = createLocation(db, { name: 'Twister', parentId: locA.id, description: null })
    updateLocation(db, locA.id, { parentId: locB.id }) // close the loop

    const type = createType(db, { name: uniqueName('CycType'), description: null, fields: [] })
    const item = createItem(db, {
      name: 'Cyclic Item',
      description: '',
      quantity: 1,
      unit: null,
      itemTypeId: type.id,
      locationId: locA.id,
      createdBy: adminUserId,
      published: true,
      fieldValues: [],
    })

    // reindexItem must walk the ancestor chain without looping or duplicating a name.
    reindexItem(db, item.id)
    expect(match('cyclone')).toEqual([item.id])
    expect(match('twister')).toEqual([item.id])
    // Each ancestor name appears exactly once in the blob (no duplicated cycle node).
    const row = db.get<{ location_path: string }>(
      sql`SELECT location_path FROM items_fts WHERE item_id = ${item.id}`
    )
    expect(row?.location_path.split(' ').sort()).toEqual(['Cyclone', 'Twister'])

    // reindexLocationSubtree on the cyclic location must also terminate and pick up the item.
    reindexLocationSubtree(db, locA.id)
    expect(match('cyclone')).toEqual([item.id])
    expect(match('twister')).toEqual([item.id])
  })

  it('removes the row from items_fts when the item is deleted', () => {
    const { itemId } = seedItem({ name: 'Lamp' })
    reindexItem(db, itemId)
    expect(ftsRowsFor(itemId)).toBe(1)

    deleteItem(db, itemId) // removes the item row (cascades its tags/fields)
    reindexItem(db, itemId) // must not leave a stale row
    expect(ftsRowsFor(itemId)).toBe(0)
  })

  it('rebuildFTS repopulates the whole index', () => {
    const a = seedItem({ name: 'Screwdriver' })
    const b = seedItem({ name: 'Wrench' })
    reindexItem(db, a.itemId)
    reindexItem(db, b.itemId)
    expect(match('screwdriver')).toEqual([a.itemId])
    expect(match('wrench')).toEqual([b.itemId])

    // Wipe the index, then rebuild from the items table.
    db.run(sql`DELETE FROM items_fts`)
    expect(match('screwdriver').length).toBe(0)

    rebuildFTS(db)
    expect(match('screwdriver')).toEqual([a.itemId])
    expect(match('wrench')).toEqual([b.itemId])
  })
})

// Write-path sync: the item create/update service must reindex the FTS row so
// an item is searchable immediately after creation and again after a rename.
// Search terms use unique tokens (not 'lamp'/'sofa') because earlier tests in
// this shared `db` leave indexed items whose blobs contain those tokens.
describe('fts write-path sync', () => {
  it('an item is searchable right after create, and re-searchable after a rename', () => {
    const { itemId } = seedItem({ name: 'Brass Lantern' })
    expect(match('lantern')).toHaveLength(1) // create must have reindexed

    // rename through the service
    updateItem(db, { id: itemId, name: 'Canvas Tote' })
    expect(match('lantern')).toHaveLength(0) // old name no longer matches
    expect(match('canvas')).toHaveLength(1) // new name is searchable
  })
})
