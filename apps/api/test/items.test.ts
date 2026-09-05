import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string

async function createTypeWithField(cookie: string, fieldType: string, fieldName: string) {
  const res = await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie }, payload: { name: `Type${Date.now()}`, fields: [{ name: fieldName, fieldType }] } })
  return res.json()?.result?.data
}

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string
})
afterAll(() => app?.close())

describe('items module', () => {
  it('creates an item with custom-field values and reads it back', async () => {
    const type = await createTypeWithField(adminCookie, 'currency', 'price')
    const res = await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'Desk', itemTypeId: type.id, locationId: null, quantity: 1, description: 'wood', fieldValues: [{ fieldId: type.fields[0].id, value: '120.00' }] } })
    const data = res.json()?.result?.data
    expect(data?.name).toBe('Desk')
    expect(data?.customFields?.[0]?.value).toBe('120.00')
  })
})
