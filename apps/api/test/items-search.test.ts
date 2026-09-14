import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations, users } from '@homebox/db'
import * as repo from '../src/modules/items/repo'

let app: ReturnType<typeof buildApp>
let adminCookie: string
let db: ReturnType<typeof createDb>

let typeId: number
let itemId: number
let tagId: number

// Seed through the tRPC write path so the FTS index is populated on each write:
// itemTypes.create → items.create (reindexes on create, task 2) → tags.create →
// tags.assign (reindexes on assign, task 4). Do NOT seed via raw repo inserts
// and then assert searchability (that would need `rebuildFTS`).
beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()

  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string

  const typeRes = await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'Lighting' } })
  typeId = typeRes.json()?.result?.data?.id

  const itemRes = await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'Brass Lantern', description: 'A brass lantern', itemTypeId: typeId, locationId: null, quantity: 1, fieldValues: [] } })
  itemId = itemRes.json()?.result?.data?.id

  const tagRes = await app.inject({ method: 'POST', url: '/trpc/tags.create', headers: { cookie: adminCookie }, payload: { name: 'heirloom' } })
  tagId = tagRes.json()?.result?.data?.id

  await app.inject({ method: 'POST', url: '/trpc/tags.assign', headers: { cookie: adminCookie }, payload: { itemId, tagIds: [tagId] } })
})
afterAll(() => app?.close())

// `items.list` is a tRPC query, and the tRPC fastify adapter's default method
// map is `query: ['GET']` (matching the rest of the codebase, e.g.
// `itemTypes.list` / `tags.list`). So call it with GET and pass input via the
// `?input=` search param (`getRawInput` reads `searchParams.get('input')`).
const list = (input: unknown) => {
  const url = `/trpc/items.list?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url, headers: { cookie: adminCookie }, contentType: 'application/json' })
}

describe('items.search across the tRPC boundary', () => {
  it('returns ranked, hydrated results + facets when searching with tagIds', async () => {
    const res = await list({ search: 'lantern', tagIds: [tagId] })
    expect(res.statusCode).toBe(200)
    const data = res.json()?.result?.data
    expect(data.items[0].id).toBe(itemId)
    // FTS5 snippets preserve the stored text's original casing ('Lantern'), so
    // compare case-insensitively.
    expect(data.items[0].snippet.toLowerCase()).toContain('lantern')
    expect(data.facets.types.length).toBeGreaterThan(0)
    expect(data.total).toBe(1)
  })

  // The search box is typed into one character at a time, so a term has to match
  // the *beginning* of a word. FTS5 matches whole tokens by default, which meant
  // "lant" found nothing and only the finished word "lantern" did — the search
  // stayed silent until you had already finished typing.
  it('matches a word by its prefix, so a half-typed term finds it', async () => {
    const res = await list({ search: 'lant' })
    expect(res.statusCode).toBe(200)
    const data = res.json()?.result?.data
    expect(data.total).toBe(1)
    expect(data.items[0].id).toBe(itemId)
  })

  // One trailing `*` covers the whole term: FTS5 reads this as `brass AND lant*`.
  it('prefix-matches the last word of a multi-word term', async () => {
    const res = await list({ search: 'brass lant' })
    expect(res.json()?.result?.data.total).toBe(1)
  })

  // The rule, pinned so changing it is a decision rather than a drift: only the
  // *last* word is a prefix — the one you are still typing. Words before it are
  // ones you have finished, and prefixing those too would make "vene lamp" match
  // "veneer lamp".
  it('requires the earlier words of a multi-word term to be complete', async () => {
    const res = await list({ search: 'bras lantern' })
    expect(res.json()?.result?.data.total).toBe(0)
  })

  // The pair that matters, and the reason quotes are load-bearing: prefixing is
  // what makes a half-typed word useful, and it is also what stops `back` from
  // ever meaning the word "back" — it matches "background" and "backup" too.
  // Quotes are the way back to precision, using FTS5's own syntax rather than a
  // wildcard rule of our own.
  it('finds a word by prefix, but a quoted term means that word exactly', async () => {
    const prefixed = await list({ search: 'lan' })
    expect(prefixed.json()?.result?.data.total).toBe(1)

    // The token "lan" does not exist — only "lantern" does — so an exact match
    // finds nothing while the prefix above finds the item. If quoting ever gets
    // prefixed, these two flip and this fails.
    const exact = await list({ search: '"lan"' })
    expect(exact.json()?.result?.data.total).toBe(0)

    const wholeWord = await list({ search: '"brass lantern"' })
    expect(wholeWord.json()?.result?.data.total).toBe(1)
  })

  // `*` is FTS5's own prefix operator, so a user who types one is already
  // speaking the syntax — appending a second would be a syntax error, which
  // would quietly drop the query into the `LIKE` fallback.
  it('leaves a term that already ends in a star alone', async () => {
    const res = await list({ search: 'lant*' })
    expect(res.statusCode).toBe(200)
    expect(res.json()?.result?.data.total).toBe(1)
  })

  // A hyphen is FTS5's column-filter operator, so `brass-lantern` is read as
  // "column brass, term lantern" and the MATCH throws. The input is then handed
  // back as one quoted string — FTS5's own escaping rule — which is valid for
  // anything, and whose tokenizer splits `brass-lantern` into `brass` + `lantern`
  // exactly as it did when the item was indexed, so the phrase matches.
  //
  // The snippet is the assertion that carries the weight: the name-only `LIKE`
  // fallback returns `snippet: null`, so a snippet proves this went through FTS5.
  it('finds a hyphenated term rather than dropping to the name-only fallback', async () => {
    const res = await list({ search: 'brass-lantern' })
    expect(res.statusCode).toBe(200)
    const data = res.json()?.result?.data
    expect(data.total).toBe(1)
    expect(data.items[0].id).toBe(itemId)
    expect(data.items[0].snippet).toBeTruthy()
  })

  it('finds a colon-separated term the same way', async () => {
    const res = await list({ search: 'brass:lantern' })
    expect(res.statusCode).toBe(200)
    expect(res.json()?.result?.data.total).toBe(1)
  })

  // Brackets group, and the app must not append its prefix star after one: a `*`
  // cannot follow a closing bracket, so `(brass OR zzz)*` is a syntax error and
  // the whole query drops to the literal fallback — where "OR" is only a word, and
  // a grouped search silently finds nothing. This is the regression test for that
  // one character in `prefixTerm`.
  it('runs a bracketed query instead of losing it to the literal fallback', async () => {
    const res = await list({ search: '(brass OR zzz)' })
    expect(res.statusCode).toBe(200)
    const data = res.json()?.result?.data
    expect(data.total).toBe(1)
    expect(data.items[0].snippet).toBeTruthy()
  })

  // The operators are capitalised. In lower case these are ordinary words, so
  // `brass or lantern` asks for the token "or" — which nothing has.
  it('treats a lower-case or as a word, not an operator', async () => {
    const res = await list({ search: 'brass or lantern' })
    expect(res.json()?.result?.data.total).toBe(0)
  })

  it('treats a capitalised OR as an operator', async () => {
    const res = await list({ search: 'brass OR lantern' })
    expect(res.json()?.result?.data.total).toBe(1)
  })

  it('returns the plain list but still computes facets when no search is given', async () => {
    const res = await list({})
    expect(res.statusCode).toBe(200)
    const data = res.json()?.result?.data
    expect(data.total).toBe(1)
    expect(data.items[0].name).toBe('Brass Lantern')
    expect(data.items[0].snippet).toBeUndefined()
    expect(data.facets.types.length).toBeGreaterThan(0)
  })

  it('does not error on a malformed fts term', async () => {
    const res = await list({ search: '"' })
    expect(res.statusCode).toBe(200)
    const data = res.json()?.result?.data
    expect(data.total).toBe(0)
    expect(data.items).toEqual([])
    expect(Array.isArray(data.facets.types)).toBe(true)
    expect(Array.isArray(data.facets.tags)).toBe(true)
    expect(Array.isArray(data.facets.locations)).toBe(true)
  })

  // Drafts are seeded directly via the repo (the tRPC write path hardcodes
  // `published: true`). `repo.createItem` reindexes into FTS, so this draft IS
  // searchable in `items_fts` — only the `published` base predicate can exclude
  // it from the list and search results.
  it('hides draft items (published=false) from list and search', async () => {
    const adminId = db.select({ id: users.id }).from(users).limit(1).get()?.id
    repo.createItem(db, {
      name: 'Draft Thing',
      description: '',
      quantity: 1,
      unit: null,
      itemTypeId: typeId,
      locationId: null,
      createdBy: adminId!,
      published: false,
      fieldValues: [],
    })

    const l = await list({})
    expect(l.statusCode).toBe(200)
    const lData = l.json()?.result?.data
    const lNames = lData.items.map((i: { name: string }) => i.name)
    expect(lNames).not.toContain('Draft Thing')
    expect(lNames).toContain('Brass Lantern')

    const s = await list({ search: 'Draft' })
    expect(s.statusCode).toBe(200)
    const sData = s.json()?.result?.data
    expect(sData.items).toEqual([])
  })
})
