import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string
let nonAdminCookie: string

const GET = (cookie: string) => app.inject({ method: 'GET', url: '/trpc/instanceSettings.get', headers: { cookie } })
const UPDATE = (cookie: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/trpc/instanceSettings.update', headers: { cookie }, payload })

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
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

describe('instanceSettings module', () => {
  it('seeds the defaults on first get (admin)', async () => {
    const res = await GET(adminCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toEqual({
      maxUploadMb: 10,
      detectionProvider: 'google',
      detectionConfig: null,
    })
  })

  it('partially updates the seeded row (admin)', async () => {
    const res = await UPDATE(adminCookie, { maxUploadMb: 25, detectionProvider: 'local' })
    expect(res.statusCode).toBe(200)
    const data = res.json().result.data
    expect(data.maxUploadMb).toBe(25)
    expect(data.detectionProvider).toBe('local')
    expect(data.detectionConfig).toBeNull()
  })

  it('rejects a non-admin with FORBIDDEN', async () => {
    const get = await GET(nonAdminCookie)
    expect(get.json()?.error?.data?.code).toBe('FORBIDDEN')
    const update = await UPDATE(nonAdminCookie, { maxUploadMb: 40 })
    expect(update.json()?.error?.data?.code).toBe('FORBIDDEN')
  })
})
