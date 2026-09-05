import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string
let nonAdminCookie: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string

  // admin creates a normal user, then that user logs in
  await app.inject({ method: 'POST', url: '/trpc/users.create', headers: { cookie: adminCookie }, payload: { name: 'B', email: 'b@b.co', password: 'password123', role: 'user' } })
  const nLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'b@b.co', password: 'password123' } })
  nonAdminCookie = nLogin.headers['set-cookie'] as string
})
afterAll(() => app?.close())

describe('itemTypes module', () => {
  it('creates a type with custom fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'Book', fields: [{ name: 'ISBN', fieldType: 'text' }] } })
    const data = res.json()?.result?.data
    expect(data?.fields?.length).toBe(1)
    expect(data?.fields?.[0]?.fieldType).toBe('text')
  })
  it('deletes an unused type', async () => {
    const res = await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'DeleteMe', fields: [] } })
    const id = res.json()?.result?.data?.id
    const del = await app.inject({ method: 'POST', url: '/trpc/itemTypes.delete', headers: { cookie: adminCookie }, payload: { id } })
    expect(del.json()?.result?.data?.id ?? del.statusCode).toBe(200)
  })
  it('lets a non-admin list types but not create them', async () => {
    const list = await app.inject({ method: 'GET', url: '/trpc/itemTypes.list', headers: { cookie: nonAdminCookie } })
    expect(list.statusCode).toBe(200)
    expect(Array.isArray(list.json()?.result?.data)).toBe(true)
    const create = await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: nonAdminCookie }, payload: { name: 'Nope', fields: [] } })
    expect(create.json()?.error?.data?.code).toBe('FORBIDDEN')
  })
})
