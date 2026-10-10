import { it, expect, beforeAll, afterAll } from 'vitest'
import { createDb, runMigrations } from '@homebox/db'
import FormData from 'form-data'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackup } from '../src/modules/backup/service'

// The photo ceiling is read once at import, so it is lowered here before the
// server module loads — in its own file, so no other suite runs under it.
let app: Awaited<ReturnType<typeof import('../src/server')['buildApp']>>
let cookie: string
let dataDir: string

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  process.env.MAX_UPLOAD_MB = '1'
  const { buildApp } = await import('../src/server')
  dataDir = mkdtempSync(join(tmpdir(), 'homebox-backup-limit-'))
  const db = createDb(':memory:'); runMigrations(db)
  app = buildApp({ db, dataDir, dbPath: join(dataDir, 'homebox.db') }); await app.ready()
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  cookie = (await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })).headers['set-cookie'] as string
})
afterAll(async () => {
  await app?.close()
  delete process.env.MAX_UPLOAD_MB
  rmSync(dataDir, { recursive: true, force: true })
})

it('accepts a backup archive larger than the photo upload ceiling', async () => {
  // Random bytes so gzip cannot shrink the archive back under 1 MB.
  mkdirSync(join(dataDir, 'uploads', 'originals'), { recursive: true })
  writeFileSync(join(dataDir, 'uploads', 'originals', 'big.bin'), randomBytes(2 * 1024 * 1024))
  const archive = join(dataDir, 'big.tar.gz')
  const source = createDb(':memory:'); runMigrations(source)
  await createBackup(source, dataDir, archive)
  const buf = readFileSync(archive)
  expect(buf.length).toBeGreaterThan(1024 * 1024)

  const form = new FormData()
  form.append('file', buf, { filename: 'backup.tar.gz', contentType: 'application/gzip' })
  const res = await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie, ...form.getHeaders() }, payload: form.getBuffer() })
  expect(res.statusCode).toBe(200)
  expect(res.json().preview.uploadCount).toBeGreaterThanOrEqual(1)
})
