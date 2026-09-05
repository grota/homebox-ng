import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let cookie: string

const createLocation = async (payload: { name: string; parentId: number | null }) => {
  const res = await app.inject({ method: 'POST', url: '/trpc/locations.create', headers: { cookie }, payload })
  return res.json()?.result?.data
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  cookie = login.headers['set-cookie'] as string
})
afterAll(() => app?.close())

describe('locations module', () => {
  it('creates nested locations and blocks delete when children exist', async () => {
    const parent = await createLocation({ name: 'Home', parentId: null })
    expect(parent.id).toBeTruthy()
    const child = await createLocation({ name: 'Garage', parentId: parent.id })
    expect(child.parentId).toBe(parent.id)
    const del = await app.inject({ method: 'POST', url: '/trpc/locations.delete', headers: { cookie }, payload: { id: parent.id } })
    expect(del.json()?.error?.data?.code).toBe('CONFLICT')
  })
})
