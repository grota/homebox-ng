import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'
import FormData from 'form-data'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
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

// Count temp dirs under os.tmpdir() with the given prefix. The backup route
// creates `homebox-backup-*` (GET /backup) and `homebox-restore-*` (upload); a
// leaked dir shows up here and is the regression we assert against. Note the test
// setup's own root uses `homebox-backup-test-*`, which also matches the backup
// prefix — so we always compare against a baseline captured before the call.
const tmpDirCount = (prefix: string): number => {
  try { return readdirSync(tmpdir()).filter((d) => d.startsWith(prefix)).length } catch { return 0 }
}

// Poll until `fn` is true (with a short timeout) — used because some temp-dir
// cleanups (the download close handler, the restore finally) are fire-and-forget.
const waitFor = async (fn: () => boolean, ms = 3000): Promise<boolean> => {
  const start = Date.now()
  while (Date.now() - start < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 25)) }
  return fn()
}

// Hand-craft a tar.gz whose member name escapes the extraction dir (`../evil.txt`),
// so the path-traversal guard must reject it. We write the raw tar bytes (rather
// than rely on `tar --transform`, which is GNU-specific) so the test is deterministic.
// `homebox.db` is a real, valid dump so that the archive is rejected because of the
// traversal member and NOT because of a failed integrity check.
const evilTarGz = (homeboxDb: Buffer): Buffer => {
  const entry = (name: string, content: Buffer): Buffer => {
    const nameBuf = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(512, 0x20)
    nameBuf.copy(header, 0, 0, 100)
    header.write('0000644', 100, 8) // mode
    header.write('0000000', 108, 8) // uid
    header.write('0000000', 116, 8) // gid
    header.write(content.length.toString(8).padStart(11, '0'), 124, 12) // size (octal)
    header.write('00000000000', 136, 12) // mtime
    header.write('\0', 156, 1) // typeflag: regular file
    header.write('ustar', 257, 5)
    header.write('00', 263, 2) // version
    let sum = 0
    for (let i = 0; i < 512; i++) sum += header[i]
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8) // checksum
    const data = Buffer.alloc(Math.ceil(content.length / 512) * 512) // pad to a 512-block
    content.copy(data, 0, 0, Math.min(content.length, data.length))
    return Buffer.concat([header, data])
  }
  const body = Buffer.concat([
    entry('../../evil.txt', Buffer.from('pwned', 'utf8')),
    entry('homebox.db', homeboxDb),
  ])
  return gzipSync(Buffer.concat([body, Buffer.alloc(1024)])) // two zero 512-blocks => end of tar
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
    const uploadDirsBefore = tmpDirCount('homebox-restore-')
    const buf = await getBackup(adminCookie)

    // Mutate the live data so it diverges from the snapshot.
    const all = (await listItems(adminCookie)).json()?.result?.data?.items
    const orig = all.find((i: { name: string }) => i.name === 'Original')
    expect(orig.name).toBe('Original')
    // `items.trash`, not `items.delete`: the item leaves the catalog either way
    // (which is what this divergence needs), but it is recoverable now.
    const del = await app.inject({ method: 'POST', url: '/trpc/items.trash', headers: { cookie: adminCookie }, payload: { id: orig.id } })
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
    // A consumed restore must not leak its temp dir (extraction + archive).
    expect(await waitFor(() => tmpDirCount('homebox-restore-') === uploadDirsBefore)).toBe(true)

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
    const dirsBefore = tmpDirCount('homebox-restore-')
    const before = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    const form = new FormData()
    form.append('file', Buffer.from('this is not a gzip archive'), { filename: 'bad.tar.gz', contentType: 'application/gzip' })
    const up = await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(up.statusCode).toBe(400)
    const after = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    expect(after).toBe(before)
    // A rejected archive must not leak its temp dir (uploaded archive + extraction).
    expect(await waitFor(() => tmpDirCount('homebox-restore-') === dirsBefore)).toBe(true)
  })

  it('does not leak the temp dir after GET /backup downloads an archive', async () => {
    const backupDirsBefore = tmpDirCount('homebox-backup-')
    // Download triggers createBackup, which materializes a full uploads copy + DB
    // dump into a `homebox-backup-*` temp dir; the download path must remove the
    // WHOLE dir (not just the archive) once streaming finishes.
    await getBackup(adminCookie)
    expect(await waitFor(() => tmpDirCount('homebox-backup-') === backupDirsBefore)).toBe(true)
  })

  it('rejects an archive that would escape the extraction dir (path traversal) and leaves the live DB untouched', async () => {
    const dirsBefore = tmpDirCount('homebox-restore-')
    const itemsBefore = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    // Build an archive from a REAL, valid dump plus a member that escapes the
    // extraction dir. With the guard, it is rejected on the traversal member; the
    // valid dump guarantees it is NOT the integrity check doing the rejecting.
    const real = await getBackup(adminCookie)
    const realDest = await extract(real)
    const db = readFileSync(join(realDest, 'homebox.db'))
    const form = new FormData()
    form.append('file', evilTarGz(db), { filename: 'evil.tar.gz', contentType: 'application/gzip' })
    const up = await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie: adminCookie, ...form.getHeaders() }, payload: form.getBuffer() })
    expect(up.statusCode).toBe(400)
    const itemsAfter = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    expect(itemsAfter).toBe(itemsBefore)
    // The rejected archive must not leak its temp dir.
    expect(await waitFor(() => tmpDirCount('homebox-restore-') === dirsBefore)).toBe(true)
  })
})
