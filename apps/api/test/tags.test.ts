import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string
let itemId: number

const post = async (path: string, payload: unknown) =>
  (await app.inject({ method: 'POST', url: `/trpc/${path}`, headers: { cookie: adminCookie }, payload })).json()?.result?.data

// tRPC queries take their input as a JSON-encoded `input` query param.
const get = async (path: string, input?: unknown) =>
  (await app.inject({
    method: 'GET',
    url: `/trpc/${path}${input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`}`,
    headers: { cookie: adminCookie },
  })).json()?.result?.data

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string

  const type = await post('itemTypes.create', { name: 'TagType', fields: [] })
  const item = await post('items.create', { name: 'Item', itemTypeId: type.id, locationId: null, quantity: 1 })
  itemId = item.id
})
afterAll(() => app?.close())

describe('tags module', () => {
  it('creates a tag and assigns it to an item', async () => {
    const tag = await post('tags.create', { name: 'fragile' })
    const res = await app.inject({ method: 'POST', url: '/trpc/tags.assign', headers: { cookie: adminCookie }, payload: { itemId, tagIds: [tag.id] } })
    expect(res.statusCode).toBe(200)
    const list = await get('tags.list')
    expect(list?.some((t: { name: string }) => t.name === 'fragile')).toBe(true)
  })

  it('renames a tag and rejects a name another tag already uses', async () => {
    const a = await post('tags.create', { name: 'alpha' })
    await post('tags.create', { name: 'beta' })

    const renamed = await post('tags.update', { id: a.id, name: 'gamma', color: '#123456' })
    expect(renamed).toMatchObject({ id: a.id, name: 'gamma', color: '#123456' })

    // A rename onto another tag's name must surface as CONFLICT rather than
    // letting the UNIQUE index on `tags.name` throw a bare 500.
    const clash = await app.inject({ method: 'POST', url: '/trpc/tags.update', headers: { cookie: adminCookie }, payload: { id: a.id, name: 'beta' } })
    expect(clash.json()?.error?.data?.code).toBe('CONFLICT')
  })

  // A rename rewrites the FTS blob of every item carrying the tag, so the item
  // must be findable under the NEW name (and not the old one).
  it('reindexes the items carrying a renamed tag', async () => {
    const tag = await post('tags.create', { name: 'reindexme' })
    await post('tags.assign', { itemId, tagIds: [tag.id] })
    await post('tags.update', { id: tag.id, name: 'renamedtag' })

    const found = await get('items.list', { search: 'renamedtag' })
    expect(found?.items?.map((i: { id: number }) => i.id)).toContain(itemId)

    const stale = await get('items.list', { search: 'reindexme' })
    expect(stale?.items?.map((i: { id: number }) => i.id)).not.toContain(itemId)
  })
})
