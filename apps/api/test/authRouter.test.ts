import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { buildApp } from '../src/server'
import { createDb, runMigrations, users } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let db: ReturnType<typeof createDb>

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  db = createDb(':memory:')
  runMigrations(db)
  app = buildApp({ db })
  await app.ready()
})
afterAll(() => app?.close())

describe('auth procedures', () => {
  it('bootstraps the admin, logs in, and returns /me', async () => {
    const setup = await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'a@b.co', password: 'password123' } })
    expect(setup.statusCode).toBe(200)

    const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'a@b.co', password: 'password123' } })
    // Fastify's inject returns a single `set-cookie` header as a plain string.
    const setCookie = login.headers['set-cookie'] as unknown as string
    expect(setCookie).toContain('session=')

    const me = await app.inject({ method: 'GET', url: '/trpc/auth.me', headers: { cookie: setCookie } })
    expect(me.json()?.result?.data?.email).toBe('a@b.co')
  })

  it('returns null for /me when unauthenticated', async () => {
    const me = await app.inject({ method: 'GET', url: '/trpc/auth.me' })
    expect(me.statusCode).toBe(200)
    expect(me.json()?.result?.data).toBeNull()
  })

  it('rejects setup when a user already exists', async () => {
    const res = await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Other', email: 'other@b.co', password: 'password123' } })
    expect(res.statusCode).toBe(403)
    expect(res.json()?.error?.data?.code).toBe('FORBIDDEN')
  })

  it('rejects bad credentials', async () => {
    const res = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'a@b.co', password: 'wrongpassword' } })
    expect(res.statusCode).toBe(401)
    expect(res.json()?.error?.data?.code).toBe('UNAUTHORIZED')
  })

  it('logs out, clears the cookie, and the session is no longer valid', async () => {
    const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'a@b.co', password: 'password123' } })
    const setCookie = login.headers['set-cookie'] as unknown as string

    // logout is a mutation with no input; POST with an empty JSON body.
    const logout = await app.inject({ method: 'POST', url: '/trpc/auth.logout', headers: { cookie: setCookie }, payload: {} })
    expect(logout.statusCode).toBe(200)
    expect(logout.headers['set-cookie'] as unknown as string).toContain('session=;')

    const me = await app.inject({ method: 'GET', url: '/trpc/auth.me', headers: { cookie: setCookie } })
    expect(me.json()?.result?.data).toBeNull()
  })

  it('treats a corrupted stored hash as a failed login, not a 500', async () => {
    // Corrupt the admin's stored hash directly, then attempt login.
    db.update(users).set({ passwordHash: 'not-a-valid-hash' }).where(eq(users.email, 'a@b.co')).run()

    const res = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'a@b.co', password: 'password123' } })
    expect(res.statusCode).toBe(401)
    expect(res.json()?.error?.data?.code).toBe('UNAUTHORIZED')
  })
})
