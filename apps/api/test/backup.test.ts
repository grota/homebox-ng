import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'
import FormData from 'form-data'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const exec = promisify(execFile)

// Known-good 1x1 transparent PNG (the thumbnail pipeline must actually decode).
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

// Access the raw better-sqlite3 driver the drizzle wrapper hides (for `.close()`).
const rawDb = (db: ReturnType<typeof createDb>) =>
  (db as unknown as { $client: { backup: (d: string) => Promise<void>; close: () => void; pragma: (s: string) => void } }).$client

const integrityOk = (dbPath: string): boolean => {
  const db = createDb(dbPath)
  try {
    const row = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    return row.integrity_check === 'ok'
  } finally {
    rawDb(db).close()
  }
}

let app: ReturnType<typeof buildApp>
let adminCookie: string
let nonAdminCookie: string
let dataDir: string
let rootDir: string
let itemTypeId: number

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret'
  rootDir = mkdtempSync(join(tmpdir(), 'homebox-backup-test-'))
  dataDir = join(rootDir, 'data')
  mkdirSync(dataDir, { recursive: true })
  const dbPath = join(rootDir, 'backup.db')
  const db = createDb(dbPath)
  runMigrations(db)
  // A REAL file-backed db is required so `.backup()`/restore can swap it in place.
  app = buildApp({ db, dataDir, dbPath })
  await app.ready()

  // Bootstrap the admin.
  await app.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@b.co', password: 'password123' } })
  const aLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@b.co', password: 'password123' } })
  adminCookie = aLogin.headers['set-cookie'] as string

  // Admin creates a normal user, then that user logs in (for role-gating).
  const create = await app.inject({ method: 'POST', url: '/trpc/users.create', headers: { cookie: adminCookie }, payload: { name: 'B', email: 'b@b.co', password: 'password123', role: 'user' } })
  expect(create.statusCode).toBe(200)
  const nLogin = await app.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'b@b.co', password: 'password123' } })
  nonAdminCookie = nLogin.headers['set-cookie'] as string

  // Seed an item type, an item, and an image so the `uploads/` tree exists.
  const type = (await app.inject({ method: 'POST', url: '/trpc/itemTypes.create', headers: { cookie: adminCookie }, payload: { name: 'SeedType', fields: [] } })).json()?.result?.data
  expect(type?.id).toBeTruthy()
  itemTypeId = type.id
  const item = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'Original', itemTypeId, locationId: null, quantity: 1 } })).json()?.result?.data
  expect(item?.id).toBeTruthy()

  const form = new FormData()
  form.append('itemId', String(item.id))
  form.append('file', png, { filename: 'seed.png', contentType: 'image/png' })
  const up = await app.inject({ method: 'POST', url: '/upload/image', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
  expect(up.statusCode).toBe(200)
})

afterAll(async () => {
  await app?.close()
  rmSync(rootDir, { recursive: true, force: true })
})

const getBackup = async (cookie: string) => {
  const res = await app.inject({ method: 'GET', url: '/backup', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('application/gzip')
  return res.rawPayload
}

const extract = async (buf: Buffer) => {
  const tmp = mkdtempSync(join(tmpdir(), 'homebox-extract-'))
  const archive = join(tmp, 'b.tar.gz')
  writeFileSync(archive, buf)
  const dest = join(tmp, 'out')
  mkdirSync(dest, { recursive: true })
  await exec('tar', ['-xzf', archive, '-C', dest])
  return dest
}

// `items.list` is a tRPC query, so the fastify adapter routes it via GET with
// the input in the `?input=` search param.
const listItems = async (cookie: string, input: unknown = {}) => {
  const url = `/trpc/items.list?input=${encodeURIComponent(JSON.stringify(input))}`
  return app.inject({ method: 'GET', url, headers: { cookie }, contentType: 'application/json' })
}

const itemNames = async (cookie: string) => {
  const res = await listItems(cookie)
  expect(res.statusCode).toBe(200)
  return (res.json()?.result?.data?.items ?? []).map((i: { name: string }) => i.name)
}

describe('backup & restore', () => {
  it('GET /backup streams a gzip archive whose dump passes integrity check and includes uploads/', async () => {
    const buf = await getBackup(adminCookie)
    const dest = await extract(buf)
    const dump = join(dest, 'homebox.db')
    expect(existsSync(dump)).toBe(true)
    expect(integrityOk(dump)).toBe(true)
    expect(existsSync(join(dest, 'uploads'))).toBe(true)
  })

  it('creates a valid backup on a fresh install with no uploads/ tree', async () => {
    // A brand-new instance has no `uploads/` directory; `createBackup` must not
    // fail (tar ENOENT) when it tars the archive. Build a minimal second app.
    const root = mkdtempSync(join(tmpdir(), 'homebox-fresh-'))
    const freshDataDir = join(root, 'data')
    mkdirSync(freshDataDir, { recursive: true })
    const freshDbPath = join(root, 'fresh.db')
    const freshDb = createDb(freshDbPath)
    runMigrations(freshDb)
    const freshApp = buildApp({ db: freshDb, dataDir: freshDataDir, dbPath: freshDbPath })
    await freshApp.ready()
    try {
      await freshApp.inject({ method: 'POST', url: '/trpc/auth.setup', payload: { name: 'Admin', email: 'admin@fresh.co', password: 'password123' } })
      const login = await freshApp.inject({ method: 'POST', url: '/trpc/auth.login', payload: { email: 'admin@fresh.co', password: 'password123' } })
      const cookie = login.headers['set-cookie'] as string
      const res = await freshApp.inject({ method: 'GET', url: '/backup', headers: { cookie } })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('application/gzip')
      const dest = await extract(res.rawPayload)
      expect(existsSync(join(dest, 'homebox.db'))).toBe(true)
      expect(integrityOk(join(dest, 'homebox.db'))).toBe(true)
      expect(existsSync(join(dest, 'uploads'))).toBe(true)
    } finally {
      await freshApp?.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('POST /upload/backup then /backup/restore swaps the live data (round-trip)', async () => {
    // Snapshot the current (Original-only) state.
    const buf = await getBackup(adminCookie)

    // Mutate the live data so it diverges from the snapshot.
    const all = (await listItems(adminCookie)).json()?.result?.data?.items
    const orig = all.find((i: { name: string }) => i.name === 'Original')
    expect(orig.name).toBe('Original')
    const del = await app.inject({ method: 'POST', url: '/trpc/items.delete', headers: { cookie: adminCookie }, payload: { id: orig.id } })
    expect(del.statusCode).toBe(200)
    const changed = (await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'Changed', itemTypeId, locationId: null, quantity: 1 } })).json()?.result?.data
    expect(changed.name).toBe('Changed')

    // Confirm we diverged before restoring.
    expect(await itemNames(adminCookie)).toContain('Changed')
    expect(await itemNames(adminCookie)).not.toContain('Original')

    // Ingest the snapshot (validate, non-destructive).
    const form = new FormData()
    form.append('file', buf, { filename: 'backup.tar.gz', contentType: 'application/gzip' })
    const up = await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(up.statusCode).toBe(200)
    const { preview, restoreId } = up.json()
    expect(preview.itemCount).toBeGreaterThanOrEqual(1)
    expect(typeof restoreId).toBe('string')

    // Confirm (destructive): swap the live DB back to the snapshot.
    const restore = await app.inject({ method: 'POST', url: '/backup/restore', headers: { cookie: adminCookie }, payload: { restoreId } })
    expect(restore.statusCode).toBe(200)
    expect(restore.json()).toEqual({ ok: true })

    // The live data now matches the restored snapshot.
    expect(await itemNames(adminCookie)).toContain('Original')
    expect(await itemNames(adminCookie)).not.toContain('Changed')
  })

  it('gates every backup route: 401 unauthenticated, 403 non-admin', async () => {
    // Unauthenticated → 401.
    const g = await app.inject({ method: 'GET', url: '/backup' })
    expect(g.statusCode).toBe(401)
    const u1 = await app.inject({ method: 'POST', url: '/upload/backup', headers: {}, payload: {} })
    expect(u1.statusCode).toBe(401)
    const r1 = await app.inject({ method: 'POST', url: '/backup/restore', headers: {}, payload: { restoreId: 'nope' } })
    expect(r1.statusCode).toBe(401)

    // Authenticated non-admin → 403.
    const g2 = await app.inject({ method: 'GET', url: '/backup', headers: { cookie: nonAdminCookie } })
    expect(g2.statusCode).toBe(403)
    const u2 = await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie: nonAdminCookie }, payload: {} })
    expect(u2.statusCode).toBe(403)
    const r2 = await app.inject({ method: 'POST', url: '/backup/restore', headers: { cookie: nonAdminCookie }, payload: { restoreId: 'nope' } })
    expect(r2.statusCode).toBe(403)
  })

  it('rejects an invalid archive with 400 and leaves the live DB untouched', async () => {
    const before = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    const form = new FormData()
    form.append('file', Buffer.from('this is not a gzip archive'), { filename: 'bad.tar.gz', contentType: 'application/gzip' })
    const up = await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(up.statusCode).toBe(400)
    const after = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    expect(after).toBe(before)
  })
})
