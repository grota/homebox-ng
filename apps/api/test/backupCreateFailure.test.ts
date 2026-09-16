import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Force the background tar to fail so the route's own catch runs. Nothing else
// reaches the failure branch deterministically: the tar needs a writable disk
// and a live DB handle, and auth needs that same handle, so the end-to-end path
// has no seam to pull. Mocking the one call that can fail is the seam.
vi.mock('../src/modules/backup/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/modules/backup/service')>()),
  createBackup: vi.fn(async () => { throw new Error('disk full') }),
}))

let app: ReturnType<typeof buildApp>
let cookie: string
let dataDir: string
let rootDir: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  rootDir = mkdtempSync(join(tmpdir(), 'homebox-createfail-'))
  dataDir = join(rootDir, 'data')
  mkdirSync(dataDir, { recursive: true })
  const db = createDb(join(rootDir, 'fail.db'))
  runMigrations(db)
  app = buildApp({ db, dataDir, dbPath: join(rootDir, 'fail.db') })
  await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@f.co', password: 'password123' } })
  const login = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@f.co', password: 'password123' } })
  cookie = login.headers['set-cookie'] as string
})

afterAll(async () => {
  await app?.close()
  rmSync(rootDir, { recursive: true, force: true })
})

// Poll the sidecar until the background job has rewritten it.
const readMeta = (id: string) => JSON.parse(readFileSync(join(dataDir, 'backups', `${id}.json`), 'utf8')) as { status: string; error?: string }
const waitFor = async (fn: () => boolean, ms = 3000): Promise<boolean> => {
  const start = Date.now()
  while (Date.now() - start < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)) }
  return fn()
}

describe('a create whose tar fails', () => {
  it("leaves a failed sidecar with the reason, not a stuck running one", async () => {
    const res = await app.inject({ method: 'POST', url: '/backups', headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const { backup } = res.json()

    // The route responds `running` (the row is durable before the response) and
    // the background job is what flips it. Left `running`, the row would also be
    // UNDELETABLE until the next restart: `deleteBackup` refuses a running row.
    expect(backup.status).toBe('running')
    expect(await waitFor(() => readMeta(backup.id).status === 'failed')).toBe(true)
    expect(readMeta(backup.id)).toEqual({ id: backup.id, status: 'failed', createdAt: backup.createdAt, error: 'disk full' })

    // And it is deletable: the failure did not strand the row.
    expect((await app.inject({ method: 'DELETE', url: `/backups/${backup.id}`, headers: { cookie } })).statusCode).toBe(200)
  })
})
