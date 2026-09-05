import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string

let typeId: number
let itemId: number
let tagId: number

// Seed through the tRPC write path so the FTS index is populated on each write:
// itemTypes.create → items.create (reindexes on create, task 2) → tags.create →
// tags.assign (reindexes on assign, task 4). Do NOT seed via raw repo inserts
// and then assert searchability (that would need `rebuildFTS`).
beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
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
})
