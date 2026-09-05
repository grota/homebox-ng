import { describe, it, expect, beforeAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createDb, runMigrations } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { reindexItem, reindexItemType, reindexLocationSubtree, rebuildFTS } from '../src/modules/items/fts'
import { createItem, deleteItem } from '../src/modules/items/repo'
import { deleteItem as deleteItemService, updateItem } from '../src/modules/items/service'
import { createType } from '../src/modules/itemTypes/repo'
import { updateItemType } from '../src/modules/itemTypes/service'
import { createLocation, updateLocation } from '../src/modules/locations/repo'
import { updateLocation as updateLocationService } from '../src/modules/locations/service'
import { createTag, replaceItemTags } from '../src/modules/tags/repo'
import { assignTags, deleteTag } from '../src/modules/tags/service'
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
  // `replaceItemTags` no longer opens its own transaction, so the seed step
  // supplies one (delete + insert must be atomic).
  db.transaction((tx) => {
    replaceItemTags(tx as unknown as DrizzleDb, item.id, [tag.id])
  })
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

// Tag assign and type/location rename must re-index the affected items so a
// change is searchable immediately. The search terms below are unique tokens:
// the in-memory `db` is shared across every test in this file, so a shared term
// (like 'gear'/'home', present in many seeded items) would not be a reliable
// "equals" assertion.
describe('tags assign + type/location rename reindex sync', () => {
  it('assigning a tag makes an item searchable by that tag', () => {
    // The item's seeded default tag is a unique `misc-N`, never 'handmade'.
    const { itemId } = seedItem({ name: 'Lounge Chair' })
    const { id: tagId } = createTag(db, { name: 'handmade', color: '#888888' })

    expect(match('handmade')).toEqual([]) // before: nothing is tagged 'handmade'

    assignTags(db, { itemId, tagIds: [tagId] })

    expect(match('handmade')).toEqual([itemId]) // after: the item matches its new tag
  })

  it('renaming a type makes its items searchable by the new name', () => {
    const { itemId, typeId } = seedItem({ name: 'Wool Rug', typeName: 'Mahogany' })

    expect(match('mahogany')).toEqual([itemId]) // old type name matches before rename

    updateItemType(db, { id: typeId, name: 'Crafted' })

    expect(match('crafted')).toEqual([itemId]) // new type name matches after rename
    expect(match('mahogany')).toEqual([]) // old type name no longer matches
  })

  it('renaming a location re-indexes the items in its subtree', () => {
    // Item lives in the 'Bay' child under the 'Depot' ancestor.
    const { itemId, locationId } = seedItem({
      name: 'Steel Cart',
      parentLocationName: 'Depot',
      locationName: 'Bay',
    })

    expect(match('depot')).toContain(itemId) // item is in the 'Depot' subtree before rename

    updateLocationService(db, { id: locationId, name: 'Atelier' })

    expect(match('atelier')).toEqual([itemId]) // subtree path recomputed -> new name matches
    expect(match('depot')).not.toContain(itemId) // old path no longer matches
  })
})

// Mutation-path sync: the item/tag/location WRITE services must keep `items_fts`
// consistent with the underlying rows, otherwise stale terms linger in search
// results. Search terms below are unique tokens (the shared `db` index carries
// terms from earlier tests).
describe('mutation-path FTS sync', () => {
  it('deleteItem clears the item row from items_fts', () => {
    const { itemId } = seedItem({ name: 'Copper Kettle' })
    expect(match('kettle')).toEqual([itemId]) // searchable right after create

    deleteItemService(db, itemId) // service delete: must also clear the FTS row

    expect(ftsRowsFor(itemId)).toBe(0) // no stale row left in the index
    expect(match('kettle')).toEqual([]) // name no longer matches
  })

  it('deleting a tag drops its name from the items that carried it', () => {
    const { itemId } = seedItem({ name: 'Wicker Basket' })
    const { id: tagId } = createTag(db, { name: 'handwoven', color: '#888888' })

    assignTags(db, { itemId, tagIds: [tagId] })
    expect(match('handwoven')).toEqual([itemId]) // item is searchable by its tag

    deleteTag(db, tagId) // service delete: reindexes every referencing item

    expect(match('handwoven')).toEqual([]) // tag name no longer matches any item
    expect(match('wicker')).toEqual([itemId]) // the item itself still exists and is searchable
  })

  it('moving a location re-indexes the items in its subtree', () => {
    // Item lives in the 'InnerBay' child under the 'GrandDepot' ancestor.
    const { itemId, childLocationId } = seedItem({
      name: 'Packing Crate',
      parentLocationName: 'GrandDepot',
      locationName: 'InnerBay',
    })

    expect(match('granddepot')).toContain(itemId) // item is in the 'GrandDepot' subtree before move

    const barn = createLocation(db, { name: 'GreenBarn', parentId: null, description: null })

    // Move 'InnerBay' under the new 'GreenBarn' ancestor: the ancestor chain
    // changes, so every item in the subtree must be reindexed.
    updateLocationService(db, { id: childLocationId, parentId: barn.id })

    expect(match('greenbarn')).toContain(itemId) // new ancestor path matches after the move
    expect(match('granddepot')).not.toContain(itemId) // old path no longer matches
  })
})
