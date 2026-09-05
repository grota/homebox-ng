import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string
let itemId: number

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string

  const type = (await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'TagType', fields: [] } })).json()?.result?.data
  const item = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'Item', itemTypeId: type.id, locationId: null, quantity: 1 } })).json()?.result?.data
  itemId = item.id
})
afterAll(() => app?.close())

describe('tags module', () => {
  it('creates a tag and assigns it to an item', async () => {
    const tag = (await app.inject({ method: 'POST', url: '/trpc/tags.create', headers: { cookie: adminCookie }, payload: { name: 'fragile' } })).json()?.result?.data
    const res = await app.inject({ method: 'POST', url: '/trpc/tags.assign', headers: { cookie: adminCookie }, payload: { itemId, tagIds: [tag.id] } })
    expect(res.statusCode).toBe(200)
    const list = (await app.inject({ method: 'GET', url: '/trpc/tags.list', headers: { cookie: adminCookie } })).json()?.result?.data
    expect(list?.some(t => t.name === 'fragile')).toBe(true)
  })
})
