import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let db: DrizzleDb
let adminCookie: string
let nonAdminCookie: string
let typeId: number

// Rows in the FTS index for all items. We query items_fts directly (same
// pattern as `apps/api/test/fts.test.ts`) to prove rebuild repopulates it.
const ftsCount = (): number => db.all<{ item_id: number }>(sql`SELECT item_id FROM items_fts`).length

const REBUILD = (cookie: string) => app.inject({ method: 'POST', url: '/trpc/system.rebuildFts', headers: { cookie }, payload: {} })
const CREATE_ITEM = (cookie: string, name: string) =>
  app.inject({
    method: 'POST',
    url: '/trpc/items.create',
    headers: { cookie },
    payload: { name, description: '', itemTypeId: typeId, locationId: null, quantity: 1, fieldValues: [] },
  })

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()

  // bootstrap admin
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string

  // admin creates a normal user, then that user logs in
  const create = await app.inject({ method: 'POST', url: '/trpc/users.create', headers: { cookie: adminCookie }, payload: { name: 'B', email: 'b@b.co', password: 'password123', role: 'user' } })
  expect(create.statusCode).toBe(200)
  const nLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'b@b.co', password: 'password123' } })
  nonAdminCookie = nLogin.headers['set-cookie'] as string

  const typeRes = await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'Lighting' } })
  typeId = typeRes.json()?.result?.data?.id
})
afterAll(() => app?.close())

describe('system module', () => {
  it('rebuildFts reports the item count and repopulates items_fts', async () => {
    // Seed three items through the tRPC write path (which reindexes each on create).
    const names = ['Brass Lantern', 'Canvas Tote', 'Wool Rug']
    for (const name of names) {
      const res = await CREATE_ITEM(adminCookie, name)
      expect(res.statusCode).toBe(200)
    }
    expect(ftsCount()).toBe(names.length) // write-path indexed each item on create

    // Simulate a corrupted/empty index, then rebuild from the items table.
    db.run(sql`DELETE FROM items_fts`)
    expect(ftsCount()).toBe(0)

    const res = await REBUILD(adminCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json()?.result?.data).toEqual({ reindexed: names.length })
    expect(ftsCount()).toBe(names.length) // index is repopulated
  })

  it('rejects a non-admin with FORBIDDEN', async () => {
    const res = await REBUILD(nonAdminCookie)
    expect(res.json()?.error?.data?.code).toBe('FORBIDDEN')
  })
})
