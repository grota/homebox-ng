import { it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import FormData from 'form-data'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup } from '../src/modules/backup/service'

// A thumbnail run that does not finish until the test says so, so a restore can be
// attempted while it is provably still running.
let finishRun: () => void = () => {}
vi.mock('../src/modules/images/regenerate', () => ({
  regenerateThumbnails: () =>
    new Promise((resolve) => {
      finishRun = () => resolve({ total: 0, rewritten: 0, resized: 0, skipped: [] })
    }),
}))

const { buildApp } = await import('../src/server')
let app: ReturnType<typeof buildApp>
let cookie: string
let dataDir: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  dataDir = mkdtempSync(join(tmpdir(), 'homebox-thumbjob-restore-'))
  const dbPath = join(dataDir, 'homebox.db')
  const db = createDb(dbPath); runMigrations(db)
  app = buildApp({ db, dataDir, dbPath }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  cookie = (await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })).headers['set-cookie'] as string
})
afterAll(async () => { await app?.close(); rmSync(dataDir, { recursive: true, force: true }) })

const validatedRestoreId = async (): Promise<string> => {
  const source = createDb(':memory:'); runMigrations(source)
  const archive = join(dataDir, 'b.tar.gz')
  await createBackup(source, dataDir, archive)
  const form = new FormData()
  form.append('file', readFileSync(archive), { filename: 'b.tar.gz', contentType: 'application/gzip' })
  const res = await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie, ...form.getHeaders() }, payload: form.getBuffer() })
  expect(res.statusCode).toBe(200)
  return res.json().restoreId
}

it('refuses to apply a restore while a thumbnail run is in progress, and allows it after', async () => {
  const restoreId = await validatedRestoreId()
  expect((await app.inject({ method: 'POST', url: '/trpc/system.regenerateThumbnails', headers: { cookie }, payload: {} })).statusCode).toBe(200)

  const refused = await app.inject({ method: 'POST', url: '/backup/restore', headers: { cookie }, payload: { restoreId } })
  expect(refused.statusCode).toBe(409)
  expect(refused.json()).toEqual({ error: 'thumbnails_in_progress' })

  finishRun()
  await new Promise((r) => setTimeout(r, 10))
  // The refusal consumed nothing: the same restoreId still applies.
  const applied = await app.inject({ method: 'POST', url: '/backup/restore', headers: { cookie }, payload: { restoreId } })
  expect(applied.statusCode).toBe(200)
})
