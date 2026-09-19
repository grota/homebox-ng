import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

// ADR-0009. Two things change together here and neither works alone:
//
//  1. each facet node carries **two** counts — items directly in it, and items in
//     its whole subtree;
//  2. a location filter selects the **subtree**, not the node.
//
// The second is what the first requires. While one level was shown at a time, a
// chip reading `home (12)` could hand back 3 items and nobody could see the two
// numbers side by side. In a tree they are adjacent, so they have to agree.

let app: ReturnType<typeof buildApp>
let adminCookie: string
let db: ReturnType<typeof createDb>
let typeId: number

type Node = {
  id: number
  name: string
  parentId: number | null
  ownCount: number
  subtreeCount: number
  unlocated?: true
  children?: Node[]
}

const list = (input: unknown) => {
  const url = `/trpc/items.list?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url, headers: { cookie: adminCookie }, contentType: 'application/json' })
}

// The roots, keyed by name, with their children nested.
const facetNodes = async (input: unknown = {}): Promise<Node[]> => {
  const res = await list(input)
  expect(res.statusCode).toBe(200)
  return res.json()?.result?.data?.facets?.locations
}

const nodeNamed = (nodes: Node[], name: string): Node | undefined => {
  for (const node of nodes) {
    if (node.name === name) return node
    const found = nodeNamed(node.children ?? [], name)
    if (found) return found
  }
  return undefined
}

const itemNames = async (input: unknown): Promise<string[]> => {
  const res = await list(input)
  expect(res.statusCode).toBe(200)
  return res.json()?.result?.data?.items.map((i: { name: string }) => i.name)
}

const seedLocation = async (name: string, parentId: number | null): Promise<number> => {
  const res = await app.inject({
    method: 'POST',
    url: '/trpc/locations.create',
    headers: { cookie: adminCookie },
    payload: { name, parentId },
  })
  return res.json()?.result?.data?.id
}

const seedItem = async (name: string, locationId: number | null): Promise<void> => {
  await app.inject({
    method: 'POST',
    url: '/trpc/items.create',
    headers: { cookie: adminCookie },
    payload: { name, description: '', itemTypeId: typeId, locationId, quantity: 1, fieldValues: [] },
  })
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:')
  runMigrations(db)
  app = buildApp({ db })
  await app.ready()

  await app.inject({
    method: 'POST',
    url: '/trpc/auth.setup',
    payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' },
  })
  const login = await app.inject({
    method: 'POST',
    url: '/trpc/auth.login',
    payload: { email: 'admin@b.co', password: 'password123' },
  })
  adminCookie = login.headers['set-cookie'] as string

  const typeRes = await app.inject({
    method: 'POST',
    url: '/trpc/itemTypes.create',
    headers: { cookie: adminCookie },
    payload: { name: 'Lighting' },
  })
  typeId = typeRes.json()?.result?.data?.id

  // home > garage > shelf A, and two sibling roots. `trastero` is deliberately
  // empty, so the zero-count case is covered by real data.
  const home = await seedLocation('home', null)
  const garage = await seedLocation('garage', home)
  const shelfA = await seedLocation('shelf A', garage)
  const shed = await seedLocation('shed', null)
  await seedLocation('trastero', null)

  await seedItem('shelf A thing one', shelfA)
  await seedItem('shelf A thing two', shelfA)
  await seedItem('garage thing', garage)
  await seedItem('home thing', home)
  await seedItem('shed thing', shed)
  await seedItem('nowhere thing', null)
})
afterAll(() => app?.close())

describe('the location facet is a tree of two counts', () => {
  it('nests children under their parents and returns the whole tree', async () => {
    const nodes = await facetNodes()

    expect(nodes.map((n) => n.name).sort()).toEqual(['Unlocated', 'home', 'shed', 'trastero'])
    expect(nodeNamed(nodes, 'home')?.children?.map((c) => c.name)).toEqual(['garage'])
    expect(nodeNamed(nodes, 'garage')?.children?.map((c) => c.name)).toEqual(['shelf A'])
  })

  it('counts the node itself and its whole subtree separately', async () => {
    const nodes = await facetNodes()

    // home holds 1 item of its own and 4 in the subtree (1 + garage 1 + shelf A 2).
    expect(nodeNamed(nodes, 'home')).toMatchObject({ ownCount: 1, subtreeCount: 4 })
    expect(nodeNamed(nodes, 'garage')).toMatchObject({ ownCount: 1, subtreeCount: 3 })
    // A leaf's two counts are the same number.
    expect(nodeNamed(nodes, 'shelf A')).toMatchObject({ ownCount: 2, subtreeCount: 2 })
  })

  it('keeps a location that holds nothing, so the tree mirrors the data', async () => {
    const nodes = await facetNodes()

    expect(nodeNamed(nodes, 'trastero')).toMatchObject({ ownCount: 0, subtreeCount: 0 })
  })

  // Without this the tree does not account for the catalog: the roots' subtree
  // counts would simply not add up to the number of items.
  it('has a node for the items with no location', async () => {
    const nodes = await facetNodes()

    const unlocated = nodes.find((n) => n.unlocated)
    expect(unlocated).toMatchObject({ ownCount: 1, subtreeCount: 1 })
    expect(unlocated?.children).toBeUndefined()
  })
})

describe('a location filter selects the whole subtree', () => {
  it('returns the descendants as well as the node itself', async () => {
    const home = (await facetNodes()).find((n) => n.name === 'home')!

    const names = await itemNames({ locationId: home.id })

    expect(names.sort()).toEqual(['garage thing', 'home thing', 'shelf A thing one', 'shelf A thing two'])
  })

  it('narrows to a leaf, which is still a subtree of itself', async () => {
    const shelfA = nodeNamed(await facetNodes(), 'shelf A')!

    expect((await itemNames({ locationId: shelfA.id })).sort()).toEqual([
      'shelf A thing one',
      'shelf A thing two',
    ])
  })

  it('selects the items with no location', async () => {
    expect(await itemNames({ locationId: 'none' })).toEqual(['nowhere thing'])
  })

  // The blast radius, asserted rather than discovered later: the type and tag
  // facets compose their WHERE through the same predicate, so a location
  // selection scopes them to the subtree too.
  it('scopes the other facet counts to the subtree as well', async () => {
    const home = (await facetNodes()).find((n) => n.name === 'home')!
    const res = await list({ locationId: home.id })
    const facets = res.json()?.result?.data?.facets

    expect(facets.types).toEqual([{ id: typeId, name: 'Lighting', count: 4 }])
  })
})

describe('a cyclic location chain', () => {
  // The data model permits a cycle; the tree walk has to terminate on one rather
  // than hang a request. Written directly because location CRUD refuses to create
  // this shape (it validates depth and cycles), which is exactly why the *read*
  // path must still survive it — it is the one that reads whatever is in the
  // table.
  it('terminates instead of hanging', async () => {
    const a = await seedLocation('cycle a', null)
    const b = await seedLocation('cycle b', a)
    db.run(sql`UPDATE locations SET parent_id = ${b} WHERE id = ${a}`)

    const res = await list({})

    expect(res.statusCode).toBe(200)
  })
})
