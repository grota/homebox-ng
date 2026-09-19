import { describe, it, expect, beforeAll } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { createItem, searchItems } from '../src/modules/items/repo'
import type { LocationFacet } from '../src/modules/items/repo'
import { createType } from '../src/modules/itemTypes/repo'
import { createLocation } from '../src/modules/locations/repo'
import { createTag } from '../src/modules/tags/repo'
import { assignTags } from '../src/modules/tags/service'
import { createUser } from '../src/modules/users/repo'

let db: DrizzleDb
let adminUserId: number

let typeA: number
let typeB: number

let garage: { id: number; name: string }
let shelf: { id: number; name: string }
let drawer: { id: number; name: string }

let fragileTag: { id: number; name: string; color: string | null }
let bulkyTag: { id: number; name: string; color: string | null }
let rareTag: { id: number; name: string; color: string | null }

let lamp: number
let table: number
let wire: number
let chair: number
let gadget: number

// Create an item through `repo.createItem` (which also reindexes the FTS row),
// then attach the given tags via `replaceItemTags` inside a transaction.
const seedItem = (opts: { name: string; description: string; itemTypeId: number; locationId: number; tagIds: number[] }): number => {
  const item = createItem(db, {
    name: opts.name,
    description: opts.description,
    quantity: 1,
    unit: null,
    itemTypeId: opts.itemTypeId,
    locationId: opts.locationId,
    createdBy: adminUserId,
    published: true,
    fieldValues: [],
  })
  // `assignTags` rewrites the item's tag links and reindexes the FTS row inside
  // one transaction, so a newly-added tag is searchable immediately.
  if (opts.tagIds.length) {
    assignTags(db, { itemId: item.id, tagIds: opts.tagIds })
  }
  return item.id
}

const sortedIds = (rows: { id: number }[]): number[] => rows.map((r) => r.id).sort((a, b) => a - b)

beforeAll(() => {
  db = createDb(':memory:')
  runMigrations(db)
  const user = createUser(db, { name: 'Seeder', email: 'seeder@test.co', passwordHash: 'x', role: 'admin' })
  adminUserId = user.id

  typeA = createType(db, { name: 'Electronics', description: null, fields: [] }).id
  typeB = createType(db, { name: 'Furniture', description: null, fields: [] }).id

  garage = createLocation(db, { name: 'Garage', parentId: null, description: null })
  shelf = createLocation(db, { name: 'Shelf', parentId: garage.id, description: null })
  drawer = createLocation(db, { name: 'Drawer', parentId: shelf.id, description: null })

  fragileTag = createTag(db, { name: 'fragile', color: '#ff0000' })
  bulkyTag = createTag(db, { name: 'bulky', color: '#00ff00' })
  rareTag = createTag(db, { name: 'rare', color: '#0000ff' })

  lamp = seedItem({ name: 'Spotlight Lamp', description: 'bright lamp', itemTypeId: typeA, locationId: garage.id, tagIds: [fragileTag.id] })
  table = seedItem({ name: 'Oak Table', description: 'bright oak table', itemTypeId: typeB, locationId: shelf.id, tagIds: [bulkyTag.id] })
  wire = seedItem({ name: 'Copper Wire', description: 'copper spool', itemTypeId: typeA, locationId: shelf.id, tagIds: [fragileTag.id] })
  chair = seedItem({ name: 'Steel Chair', description: 'steel chair', itemTypeId: typeB, locationId: garage.id, tagIds: [bulkyTag.id, rareTag.id] })
  gadget = seedItem({ name: 'Tiny Gadget', description: 'tiny gadget', itemTypeId: typeA, locationId: drawer.id, tagIds: [rareTag.id] })
})

describe('searchItems ranked FTS search', () => {
  // The location facet is a nested tree (ADR-0009) and a node carries two counts,
  // so a top-level `find` only reaches the roots and `.count` no longer exists.
  const facetNode = (nodes: LocationFacet[], id: number | 'none'): LocationFacet | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node
      const found = facetNode(node.children ?? [], id)
      if (found) return found
    }
    return undefined
  }
  const countsOf = (nodes: LocationFacet[], id: number | 'none') => {
    const node = facetNode(nodes, id)
    return node ? { ownCount: node.ownCount, subtreeCount: node.subtreeCount } : undefined
  }

  it('searches ranked across name/description/tags/type/location with a non-null snippet', () => {
    const byName = searchItems(db, { search: 'spotlight' })
    expect(sortedIds(byName.rows)).toEqual([lamp])
    expect(byName.total).toBe(1)
    expect(byName.rows[0].snippet).toBeTruthy()

    const byDesc = searchItems(db, { search: 'spool' })
    expect(sortedIds(byDesc.rows)).toEqual([wire])
    expect(byDesc.rows[0].snippet).toBeTruthy()

    const byTag = searchItems(db, { search: 'fragile' })
    expect(sortedIds(byTag.rows)).toEqual([lamp, wire])
    expect(byTag.total).toBe(2)
    expect(byTag.rows.every((r) => r.snippet != null)).toBe(true)

    const byType = searchItems(db, { search: 'furniture' })
    expect(sortedIds(byType.rows)).toEqual([table, chair])
    expect(byType.rows.every((r) => r.snippet != null)).toBe(true)

    const byLocation = searchItems(db, { search: 'drawer' })
    expect(sortedIds(byLocation.rows)).toEqual([gadget])
    expect(byLocation.rows[0].snippet).toBeTruthy()
  })

  it('applies locationId + itemTypeId as AND, and tagIds as OR-within-dimension', () => {
    // AND: Garage location AND Electronics type. A location selects its whole
    // subtree (ADR-0009), so this is Garage + Shelf + Drawer's electronics.
    const andResult = searchItems(db, { locationId: garage.id, itemTypeId: typeA })
    expect(sortedIds(andResult.rows)).toEqual([lamp, wire, gadget])
    expect(andResult.total).toBe(3)

    // The same AND on a leaf is the narrow case: Drawer holds one electronics item.
    const leaf = searchItems(db, { locationId: drawer.id, itemTypeId: typeA })
    expect(sortedIds(leaf.rows)).toEqual([gadget])

    // tagIds OR-within-dimension: an item with ANY of the selected tags matches.
    const tagOr = searchItems(db, { tagIds: [fragileTag.id, bulkyTag.id] })
    expect(sortedIds(tagOr.rows)).toEqual([lamp, table, wire, chair]) // gadget has only 'rare'
    expect(tagOr.total).toBe(4)

    // AND of location with a single tag.
    const locAndTag = searchItems(db, { locationId: garage.id, tagIds: [bulkyTag.id] })
    expect(sortedIds(locAndTag.rows)).toEqual([table, chair])
    expect(locAndTag.total).toBe(2)

    // No-search path reuses the plain filter and still returns facets (the type
    // dimension is excluded from the type facet).
    const noSearch = searchItems(db, { locationId: garage.id })
    expect(sortedIds(noSearch.rows)).toEqual([lamp, table, wire, chair, gadget])
    expect(noSearch.total).toBe(5)
    expect(noSearch.facets.types).toEqual([
      { id: typeA, name: 'Electronics', count: 3 },
      { id: typeB, name: 'Furniture', count: 2 },
    ])
  })

  it('computes facet counts excluding each dimension’s own selection', () => {
    // Types facet: search 'bright' (matches lamp+table), then filter to typeA.
    // The types facet omits the type filter, so it must show BOTH types.
    const withType = searchItems(db, { search: 'bright', itemTypeId: typeA })
    expect(sortedIds(withType.rows)).toEqual([lamp]) // only the typeA match
    expect(withType.total).toBe(1)
    expect(withType.facets.types).toEqual([
      { id: typeA, name: 'Electronics', count: 1 },
      { id: typeB, name: 'Furniture', count: 1 },
    ])

    // Tags facet: filter by 'fragile', but the tags facet omits tagIds, so it
    // must show every tag present on the matching set ('bright' → lamp+table).
    const withTag = searchItems(db, { search: 'bright', tagIds: [fragileTag.id] })
    expect(sortedIds(withTag.rows)).toEqual([lamp]) // only the fragile item
    expect(withTag.total).toBe(1)
    expect(withTag.facets.tags).toEqual([
      { id: bulkyTag.id, name: 'bulky', color: '#00ff00', count: 1 },
      { id: fragileTag.id, name: 'fragile', color: '#ff0000', count: 1 },
    ])

    // Locations facet: the search is 'bright' (lamp + table), and the facet omits
    // the location filter, so the whole tree comes back with both counts per node.
    const withLoc = searchItems(db, { search: 'bright', locationId: garage.id })
    expect(sortedIds(withLoc.rows)).toEqual([lamp, table])
    expect(withLoc.total).toBe(2)
    expect(countsOf(withLoc.facets.locations, garage.id)).toEqual({ ownCount: 1, subtreeCount: 2 })
    expect(countsOf(withLoc.facets.locations, shelf.id)).toEqual({ ownCount: 1, subtreeCount: 1 })
  })

  it('returns the whole tree, with a count for every node', () => {
    // 'tiny' matches only the Drawer item, two levels down. The whole tree comes
    // back — any branch can be opened — and it is the ancestor's *subtree* count
    // that makes the deep item visible from the root.
    const deep = searchItems(db, { search: 'tiny' })
    expect(sortedIds(deep.rows)).toEqual([gadget])
    expect(countsOf(deep.facets.locations, garage.id)).toEqual({ ownCount: 0, subtreeCount: 1 })
    expect(countsOf(deep.facets.locations, shelf.id)).toEqual({ ownCount: 0, subtreeCount: 1 })
    expect(countsOf(deep.facets.locations, drawer.id)).toEqual({ ownCount: 1, subtreeCount: 1 })

    // And it is nested, not a flat list of every location.
    expect(facetNode(deep.facets.locations, garage.id)?.children?.map((c) => c.id)).toEqual([shelf.id])
    expect(facetNode(deep.facets.locations, shelf.id)?.children?.map((c) => c.id)).toEqual([drawer.id])
  })

  it('a malformed FTS term falls back to a literal name LIKE without throwing', () => {
    // The lone double-quote is a syntax error to FTS5; the fallback must not
    // throw and must return the items whose name literally contains it (none).
    let res: ReturnType<typeof searchItems>
    expect(() => {
      res = searchItems(db, { search: '"' })
    }).not.toThrow()
    expect(res!.rows).toEqual([])
    expect(res!.total).toBe(0)
    expect(res!.facets.types).toEqual([])
    expect(res!.facets.tags).toEqual([])
    expect(countsOf(res!.facets.locations, garage.id)).toEqual({ ownCount: 0, subtreeCount: 0 })

    // A term that is valid FTS but matches nothing is NOT an error — it returns
    // 0 rows via the FTS path (no fallback trigger, still no throw).
    const miss = searchItems(db, { search: 'zzznotfound' })
    expect(miss.rows).toEqual([])
    expect(miss.total).toBe(0)
  })
})
