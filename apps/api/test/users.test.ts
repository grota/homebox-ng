import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations, users } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let db: ReturnType<typeof createDb>
let adminCookie: string
let nonAdminCookie: string

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
})
afterAll(() => app?.close())

describe('users module', () => {
  it('lets an admin create a user (forced to change password)', async () => {
    const res = await app.inject({ method: 'POST', url: '/trpc/users.create', headers: { cookie: adminCookie }, payload: { name: 'C', email: 'c@c.co', password: 'password123', role: 'user' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()?.result?.data?.role).toBe('user')
    expect(res.json()?.result?.data?.mustChangePassword).toBe(true)
  })
  it('re-sets mustChangePassword when an admin resets a password', async () => {
    const create = await app.inject({ method: 'POST', url: '/trpc/users.create', headers: { cookie: adminCookie }, payload: { name: 'E', email: 'e@e.co', password: 'password123', role: 'user' } })
    const created = create.json()?.result?.data
    expect(created.mustChangePassword).toBe(true)

    // Simulate the user having already changed their password (flag cleared).
    db.update(users).set({ mustChangePassword: false }).where(eq(users.id, created.id)).run()

    const update = await app.inject({ method: 'POST', url: '/trpc/users.update', headers: { cookie: adminCookie }, payload: { id: created.id, password: 'newpassword123' } })
    expect(update.json()?.result?.data?.mustChangePassword).toBe(true)
  })
  it('rejects a non-admin', async () => {
    const res = await app.inject({ method: 'POST', url: '/trpc/users.create', headers: { cookie: nonAdminCookie }, payload: { name: 'D', email: 'd@d.co', password: 'password123', role: 'user' } })
    expect(res.json()?.error?.data?.code).toBe('FORBIDDEN')
  })
})
