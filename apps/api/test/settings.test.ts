import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
let adminCookie: string

const GET = () => app.inject({ method: 'GET', url: '/trpc/settings.get', headers: { cookie: adminCookie } })
const UPDATE = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/trpc/settings.update', headers: { cookie: adminCookie }, payload })

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = login.headers['set-cookie'] as string
})
afterAll(() => app?.close())

describe('settings module', () => {
  it('returns the spec defaults when no row exists yet', async () => {
    const res = await GET()
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toEqual({
      language: 'en', locale: 'en-US', themeMode: 'auto',
      lightThemeId: 'light-default', darkThemeId: 'dark-default',
      itemsSort: 'createdAt:desc',
    })
  })

  it('upserts on a partial update', async () => {
    const res = await UPDATE({ themeMode: 'dark', locale: 'de-DE' })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toEqual({
      language: 'en', locale: 'de-DE', themeMode: 'dark',
      lightThemeId: 'light-default', darkThemeId: 'dark-default',
      itemsSort: 'createdAt:desc',
    })
    // A second update is additive and keeps a single row (upsert, not duplicate).
    const second = await UPDATE({ language: 'en' })
    expect(second.statusCode).toBe(200)
    expect(second.json().result.data.themeMode).toBe('dark')
  })

  it('rejects unauthenticated requests', async () => {
    const get = await app.inject({ method: 'GET', url: '/trpc/settings.get' })
    expect(get.statusCode).toBe(401)
    const update = await app.inject({ method: 'POST', url: '/trpc/settings.update', payload: { themeMode: 'dark' } })
    expect(update.statusCode).toBe(401)
  })

  // The catalog's ordering is a per-user preference, so it lives with the other
  // per-user preferences rather than in instance settings: how you read a list is
  // yours, not the instance's.
  it('defaults the catalog ordering to newest-first, and stores a chosen one', async () => {
    expect((await GET()).json().result.data.itemsSort).toBe('createdAt:desc')

    const updated = await UPDATE({ itemsSort: 'name:asc' })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().result.data.itemsSort).toBe('name:asc')

    // Stored, not just echoed back.
    expect((await GET()).json().result.data.itemsSort).toBe('name:asc')
  })

  // `relevance` is legal on the wire while a search term is active and is never a
  // stored preference: with no term there is no rank, so storing it would mean a
  // preference that silently means something else.
  it('refuses to store relevance as a preference', async () => {
    const res = await UPDATE({ itemsSort: 'relevance' })

    expect(res.statusCode).toBe(400)
  })
})
