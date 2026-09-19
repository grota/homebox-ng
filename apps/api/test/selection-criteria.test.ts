import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

// A **criteria clause** resolves to a set of item ids: that is what "add to
// selection", "remove from selection" and "select all N matching" all need, and
// it is why one read backs all three.
//
// The rule that matters is that a clause and the sidebar filter mean the same
// thing, because they compose the same predicate — same base guards (published,
// not trashed), same tag union, same subtree-inclusive location.

let app: ReturnType<typeof buildApp>
let adminCookie: string
let db: ReturnType<typeof createDb>

const call = (proc: string, input?: unknown) => {
  const suffix = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url: `/trpc/${proc}${suffix}`, headers: { cookie: adminCookie } })
}

const ids = async (input: unknown): Promise<number[]> => {
  const res = await call('items.resolveSelection', input)
  expect(res.statusCode).toBe(200)
  return res.json()?.result?.data?.ids
}

const listTotal = async (input: unknown): Promise<number> => {
  const res = await call('items.list', input)
  return res.json()?.result?.data?.total
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

const seedTag = async (name: string): Promise<number> => {
  const res = await app.inject({
    method: 'POST',
    url: '/trpc/tags.create',
    headers: { cookie: adminCookie },
    payload: { name },
  })
  return res.json()?.result?.data?.id
}

type Seeded = { id: number; name: string }
let home: number
let garage: number
let shelfA: number
let typeA: number
let typeB: number
let fragile: number
let bulky: number
let items: Record<string, Seeded> = {}

const seedItem = async (name: string, locationId: number | null, itemTypeId: number, tagIds: number[] = []) => {
  const res = await app.inject({
    method: 'POST',
    url: '/trpc/items.create',
    headers: { cookie: adminCookie },
    payload: { name, description: '', itemTypeId, locationId, quantity: 1, fieldValues: [] },
  })
  const created = res.json()?.result?.data
  items[name] = created
  if (tagIds.length) {
    await app.inject({
      method: 'POST',
      url: '/trpc/tags.assign',
      headers: { cookie: adminCookie },
      payload: { itemId: created.id, tagIds },
    })
  }
  return created
}

const seedType = async (name: string): Promise<number> => {
  const res = await app.inject({
    method: 'POST',
    url: '/trpc/itemTypes.create',
    headers: { cookie: adminCookie },
    payload: { name },
  })
  return res.json()?.result?.data?.id
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

  typeA = await seedType('Electronics')
  typeB = await seedType('Furniture')
  home = await seedLocation('home', null)
  garage = await seedLocation('garage', home)
  shelfA = await seedLocation('shelf A', garage)
  fragile = await seedTag('fragile')
  bulky = await seedTag('bulky')

  await seedItem('lamp', garage, typeA, [fragile])
  await seedItem('table', shelfA, typeB, [bulky])
  await seedItem('wire', shelfA, typeA, [fragile])
  await seedItem('chair', home, typeB, [bulky, fragile])
  await seedItem('gadget', null, typeA)

  // Known creation days, so the date clause is a fact and not a race. `mid` and
  // `late` share a day on purpose: a `to` bound has to include the whole day.
  const day = (d: string) => Date.parse(`${d}T12:00:00.000Z`)
  db.run(sql`UPDATE items SET created_at = ${day('2026-01-10')} WHERE name = 'lamp'`)
  db.run(sql`UPDATE items SET created_at = ${day('2026-02-20')} WHERE name = 'table'`)
  db.run(sql`UPDATE items SET created_at = ${day('2026-02-20')} WHERE name = 'wire'`)
  db.run(sql`UPDATE items SET created_at = ${day('2026-03-05')} WHERE name = 'chair'`)
  db.run(sql`UPDATE items SET created_at = ${day('2026-04-01')} WHERE name = 'gadget'`)

  // A draft and a trashed item: neither is a catalog item, so neither can ever be
  // resolved into a selection.
  const draft = await seedItem('a draft', garage, typeA)
  db.run(sql`UPDATE items SET published = 0 WHERE id = ${draft.id}`)
  const doomed = await seedItem('a doomed thing', garage, typeA)
  await app.inject({
    method: 'POST',
    url: '/trpc/items.trash',
    headers: { cookie: adminCookie },
    payload: { id: doomed.id },
  })
})
afterAll(() => app?.close())

describe('resolving a criteria clause', () => {
  it('resolves every catalog item when the clause is empty', async () => {
    const found = await ids({})

    // Five catalog items: the draft and the trashed one are not among them.
    expect(found.sort()).toEqual([items.lamp.id, items.table.id, items.wire.id, items.chair.id, items.gadget.id].sort())
  })

  it('resolves tags as a union, matching the sidebar filter', async () => {
    expect(await ids({ tagIds: [fragile, bulky] })).toEqual(
      expect.arrayContaining([items.lamp.id, items.wire.id, items.table.id, items.chair.id]),
    )
    expect(await ids({ tagIds: [fragile] })).toEqual(
      expect.arrayContaining([items.lamp.id, items.wire.id, items.chair.id]),
    )
  })

  it('resolves a location as its whole subtree', async () => {
    const found = await ids({ locationIds: [garage] })

    expect(found.sort()).toEqual([items.lamp.id, items.table.id, items.wire.id].sort())
  })

  // The bucket that is not a location, alongside real ones.
  it('resolves the items with no location', async () => {
    expect(await ids({ locationIds: ['none'] })).toEqual([items.gadget.id])
    expect((await ids({ locationIds: [shelfA, 'none'] })).sort()).toEqual(
      [items.table.id, items.wire.id, items.gadget.id].sort(),
    )
  })

  it('resolves a creation-date range, including the whole of the end day', async () => {
    const february = await ids({ createdFrom: '2026-02-01', createdTo: '2026-02-28' })

    // Both of the 20th, and neither the January nor the March item.
    expect(february.sort()).toEqual([items.table.id, items.wire.id].sort())

    // A single day is a range of one day, not an empty range: the `to` bound is
    // the end of that day, not its midnight.
    expect(await ids({ createdFrom: '2026-02-20', createdTo: '2026-02-20' })).toEqual(
      expect.arrayContaining([items.table.id, items.wire.id]),
    )

    expect(await ids({ createdFrom: '2026-03-01' })).toEqual(expect.arrayContaining([items.chair.id, items.gadget.id]))
  })

  it('composes clauses with AND', async () => {
    const found = await ids({ locationIds: [garage], itemTypeId: typeB })

    // Garage's subtree holds the Electronics lamp and wire, and the Furniture table.
    expect(found).toEqual([items.table.id])
  })

  it('resolves a search term the same way the list does', async () => {
    expect(await ids({ search: 'wire' })).toEqual([items.wire.id])

    // A term FTS5 reads as *syntax* — a hyphen or a colon is a column filter — must
    // not resolve to something the list would not show. Both sides go through the
    // same quoted retry, so they agree; the assertion is the agreement rather than
    // a count, because for these terms that count is legitimately zero.
    for (const term of ['wd-40', 'wire OR']) {
      expect((await ids({ search: term })).length).toBe(await listTotal({ search: term }))
    }
  })

  // The clause and the list must agree, or "select all 12 matching" would select a
  // different twelve.
  it('agrees with the list it was built from', async () => {
    const clause = { search: 'a', itemTypeId: typeA }

    expect((await ids(clause)).length).toBe(await listTotal(clause))
  })

  it('rejects a malformed date', async () => {
    const res = await call('items.resolveSelection', { createdFrom: '20-02-2026' })

    expect(res.statusCode).toBe(400)
  })
})

describe('the catalog creation-date span', () => {
  it('reports the real first and last day, so a picker cannot offer an empty range', async () => {
    const res = await call('items.createdAtRange')
    expect(res.statusCode).toBe(200)

    expect(res.json()?.result?.data).toEqual({ min: '2026-01-10', max: '2026-04-01' })
  })
})
