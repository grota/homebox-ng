import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'

let app: ReturnType<typeof buildApp>
beforeAll(async () => {
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db }); await app.ready()
})
afterAll(() => app.close())

describe('server', () => {
  it('serves /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('serves the tRPC ping procedure over the /trpc transport', async () => {
    // ping is a query: the HTTP transport serves queries via GET at /trpc/<proc>
    const res = await app.inject({ method: 'GET', url: '/trpc/ping' })
    expect(res.statusCode).toBe(200)
    expect(res.json().result.data).toBe('pong')
  })
})
