import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

// The catalog was pinned to newest-first with no way to ask for anything else.
// It sorts now, and every ordering ends in `items.id`.
//
// The tiebreak is the part worth a test file: without a unique final key, rows
// sharing the sort value swap places between requests and LIMIT/OFFSET paging
// then skips or repeats them. That is reachable rather than theoretical — an
// unpack or a bulk publish stamps many items with the same `created_at`.

let app: ReturnType<typeof buildApp>
let adminCookie: string
let db: ReturnType<typeof createDb>

// `items.list` is a GET-routed tRPC query (see items-search.test.ts).
const list = (input: unknown) => {
  const url = `/trpc/items.list?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url, headers: { cookie: adminCookie }, contentType: 'application/json' })
}

const names = async (input: unknown): Promise<string[]> => {
  const res = await list(input)
  expect(res.statusCode).toBe(200)
  return res.json()?.result?.data?.items.map((i: { name: string }) => i.name)
}

const idsOf = async (input: unknown): Promise<number[]> => {
  const res = await list(input)
  expect(res.statusCode).toBe(200)
  return res.json()?.result?.data?.items.map((i: { id: number }) => i.id)
}

// The four seeded items, in `items.id` order (creation order). Two words each so
// that a *token* — "crate" — matches three of them, which is what the search
// case below needs: FTS5 matches whole tokens by prefix, not substrings, so a
// shared prefix or word is the only way to match several rows at once.
const ZEBRA = 'zebra stripes'
const APPLE = 'Apple crate'
const BANANA = 'banana crate'
const CHERRY = 'Cherry crate'

// The seeded items are created in an order that is deliberately *not* the order
// any test below wants, and `created_at` is stamped by the insert, so each test
// that depends on a timestamp sets it explicitly — none of them inherits the
// previous test's, or the file would only pass in one order.
const setCreatedAt = (map: Record<string, number>) => {
  for (const [name, ms] of Object.entries(map)) {
    db.run(sql`UPDATE items SET created_at = ${ms} WHERE name = ${name}`)
  }
}

// The canonical stamps: ZEBRA oldest, then APPLE, BANANA, CHERRY.
const baseTimestamps = () => setCreatedAt({ [ZEBRA]: 1000, [APPLE]: 2000, [BANANA]: 3000, [CHERRY]: 4000 })

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
  const typeId = typeRes.json()?.result?.data?.id

  // Name order (Apple crate, banana crate, Cherry crate, zebra stripes) is
  // unlike creation order and every timestamp order below.
  for (const name of [ZEBRA, APPLE, BANANA, CHERRY]) {
    await app.inject({
      method: 'POST',
      url: '/trpc/items.create',
      headers: { cookie: adminCookie },
      payload: { name, description: '', itemTypeId: typeId, locationId: null, quantity: 1, fieldValues: [] },
    })
  }
  setCreatedAt({ [ZEBRA]: 1000, [APPLE]: 2000, [BANANA]: 3000, [CHERRY]: 4000 })
})
afterAll(() => app?.close())

describe('the catalog can be ordered', () => {
  it('orders by name, case-insensitively, when asked', async () => {
    // Not `Apple crate, Cherry crate, banana crate, zebra stripes`: SQLite's
    // default collation is byte order, which sorts every uppercase name before
    // every lowercase one.
    expect(await names({ sort: 'name:asc' })).toEqual([APPLE, BANANA, CHERRY, ZEBRA])
  })

  it('reverses that order when asked', async () => {
    expect(await names({ sort: 'name:desc' })).toEqual([ZEBRA, CHERRY, BANANA, APPLE])
  })

  it('orders newest-first by default, and when asked explicitly', async () => {
    baseTimestamps()

    // The default is what it always was, so nothing that omits `sort` moves.
    expect(await names({})).toEqual([CHERRY, BANANA, APPLE, ZEBRA])
    expect(await names({ sort: 'createdAt:desc' })).toEqual([CHERRY, BANANA, APPLE, ZEBRA])
  })

  it('orders oldest-first when asked', async () => {
    baseTimestamps()

    expect(await names({ sort: 'createdAt:asc' })).toEqual([ZEBRA, APPLE, BANANA, CHERRY])
  })

  it('orders by last update, which is a different order from creation', async () => {
    for (const [name, ms] of Object.entries({ [ZEBRA]: 9000, [APPLE]: 1000, [BANANA]: 2000, [CHERRY]: 3000 })) {
      db.run(sql`UPDATE items SET updated_at = ${ms} WHERE name = ${name}`)
    }

    expect(await names({ sort: 'updatedAt:asc' })).toEqual([APPLE, BANANA, CHERRY, ZEBRA])
  })
})

describe('every ordering is total', () => {
  // Three items sharing one timestamp — what a bulk create produces. Ids: 2, 3, 4.
  const tied = () => setCreatedAt({ [ZEBRA]: 1000, [APPLE]: 5000, [BANANA]: 5000, [CHERRY]: 5000 })

  it('breaks a tie on the sort column with the id', async () => {
    tied()

    // Ids descend among the tied three (4, 3, 2), then the untied oldest one.
    expect(await idsOf({ sort: 'createdAt:desc' })).toEqual([4, 3, 2, 1])
  })

  it('pages through tied rows without skipping or repeating any', async () => {
    tied()

    const first = await idsOf({ sort: 'createdAt:desc', page: 1, pageSize: 2 })
    const second = await idsOf({ sort: 'createdAt:desc', page: 2, pageSize: 2 })

    expect(first).toEqual([4, 3])
    expect(second).toEqual([2, 1])
    // The whole point: together they are every item, exactly once.
    expect([...first, ...second].sort()).toEqual([1, 2, 3, 4])
  })
})

describe('the ordering input', () => {
  it('rejects an order it does not know', async () => {
    const res = await list({ sort: 'price:asc' })

    expect(res.statusCode).toBe(400)
  })

  // Ranked search is the default *while searching* and stays so; the existing
  // `items-search.test.ts` pins that ordering. An explicit order overriding it
  // is what is new here.
  //
  // Asserted with `name:desc` on purpose: a `rank` tie falls back to rowid
  // order, which for these fixtures is the *ascending* name order, so asserting
  // `name:asc` would pass against an implementation that ignores `sort`
  // entirely and proves nothing.
  it('lets an explicit order override relevance while searching', async () => {
    const found = await names({ search: 'crate', sort: 'name:desc' })

    // `crate` matches APPLE, BANANA and CHERRY; ZEBRA has no such token.
    expect(found).toEqual([CHERRY, BANANA, APPLE])
  })

  // `relevance` is a legal request that is never a stored preference. With no
  // search term there is no rank to order by, so it has to mean something.
  it('falls back to newest-first when relevance is asked for with no search term', async () => {
    baseTimestamps()

    expect(await names({ sort: 'relevance' })).toEqual([CHERRY, BANANA, APPLE, ZEBRA])
  })
})
