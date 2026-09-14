import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/server'
import { createDb, runMigrations } from '@homebox/db'
import FormData from 'form-data'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createBackup } from '../src/modules/backup/service'

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

// Same contract as before: create a backup, return its bytes. Now a stored row
// rather than a stream from the deleted `GET /backup`.
const getBackup = async (cookie: string): Promise<Buffer> => {
  const { id } = await createBackupRow(cookie)
  const res = await app.inject({ method: 'GET', url: `/backups/${id}/download`, headers: { cookie } })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('application/gzip')
  return res.rawPayload
}

// Start a server-side backup and wait for the background job to finish. "Finish"
// is the sidecar flipping to `completed`, which happens only after the tar lands
// — not `existsSync(archive)`, which is true from the START of the tar because
// `createBackup` writes straight to the destination (no temp + rename). Waiting
// on the archive would leave the sidecar still `running` (breaking the caller's
// assertion) and the create guard still set (breaking the next test's 409).
// Observing `completed` also proves the guard is clear: `creating = false` runs
// in the same microtask as the completing `writeBackupMeta`, so no event-loop
// turn can slip in between.
const createBackupRow = async (cookie: string): Promise<{ id: string }> => {
  const res = await app.inject({ method: 'POST', url: '/backups', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const { backup } = res.json()
  const metaFile = join(dataDir, 'backups', `${backup.id}.json`)
  expect(await waitFor(() => (JSON.parse(readFileSync(metaFile, 'utf8')) as { status: string }).status === 'completed')).toBe(true)
  return { id: backup.id as string }
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

// An archive's member names, read from the bytes with `tar -tzf` — the archive's
// own contents, not what extraction happened to leave on disk. Note `-t` lists
// recursively and GNU tar marks directories with a trailing `/`, so a caller
// wanting top-level entries splits each name on `/`.
const members = async (buf: Buffer): Promise<string[]> => {
  const tmp = mkdtempSync(join(tmpdir(), 'homebox-members-'))
  try {
    const archive = join(tmp, 'b.tar.gz')
    writeFileSync(archive, buf)
    const { stdout } = await exec('tar', ['-tzf', archive])
    return stdout.trim().split('\n').filter(Boolean)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// Count temp dirs under os.tmpdir() with the given prefix. A backup create
// stages `homebox-backup-*` and the upload path stages `homebox-restore-*`; a
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
  it('downloads an archive whose dump passes integrity check and includes uploads/', async () => {
    const buf = await getBackup(adminCookie)
    const dest = await extract(buf)
    const dump = join(dest, 'homebox.db')
    expect(existsSync(dump)).toBe(true)
    expect(integrityOk(dump)).toBe(true)
    expect(existsSync(join(dest, 'uploads'))).toBe(true)

    // The layout is exactly the dump and the uploads tree — nothing else. This
    // instance HAS stored backups on disk (`dataDir/backups/`, where this very
    // archive lives), so a naive `tar` of the data dir would nest them here. It
    // does not: `createBackup` stages the two entries and tars those, so a backup
    // can never contain another backup (nor balloon as the history grows).
    const topLevel = [...new Set((await members(buf)).map((m) => m.split('/')[0]))]
    expect(topLevel.sort()).toEqual(['homebox.db', 'uploads'])
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
      const start = await freshApp.inject({ method: 'POST', url: '/backups', headers: { cookie } })
      expect(start.statusCode).toBe(200)
      const { backup } = start.json()
      // Wait on the sidecar, not the archive — `createBackup` tars straight to
      // the destination, so the file exists from the moment `tar` opens it.
      const metaFile = join(freshDataDir, 'backups', `${backup.id}.json`)
      expect(await waitFor(() => (JSON.parse(readFileSync(metaFile, 'utf8')) as { status: string }).status === 'completed')).toBe(true)
      const res = await freshApp.inject({ method: 'GET', url: `/backups/${backup.id}/download`, headers: { cookie } })
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
    const id = randomUUID()
    const routes: Array<[string, string]> = [
      ['POST', '/backups'],
      ['GET', '/backups'],
      ['GET', `/backups/${id}/download`],
      ['DELETE', `/backups/${id}`],
      ['POST', `/backups/${id}/restore`],
    ]
    for (const [method, url] of routes) {
      const anon = await app.inject({ method: method as 'GET', url })
      expect([url, anon.statusCode]).toEqual([url, 401])
      const nonAdmin = await app.inject({ method: method as 'GET', url, headers: { cookie: nonAdminCookie } })
      expect([url, nonAdmin.statusCode]).toEqual([url, 403])
    }
    // The upload path keeps its own gating.
    expect((await app.inject({ method: 'POST', url: '/upload/backup', headers: {}, payload: {} })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/upload/backup', headers: { cookie: nonAdminCookie }, payload: {} })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/backup/restore', headers: {}, payload: { restoreId: 'nope' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/backup/restore', headers: { cookie: nonAdminCookie }, payload: { restoreId: 'nope' } })).statusCode).toBe(403)
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

  it('does not leak the staging temp dir after creating a stored backup', async () => {
    const before = tmpDirCount('homebox-backup-')
    await createBackupRow(adminCookie)
    expect(await waitFor(() => tmpDirCount('homebox-backup-') === before)).toBe(true)
  })

  it('downloads a stored backup with a timestamped filename', async () => {
    const { id } = await createBackupRow(adminCookie)
    const res = await app.inject({ method: 'GET', url: `/backups/${id}/download`, headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/gzip')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="homebox-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.tar\.gz"/)
    const dest = await extract(res.rawPayload)
    expect(integrityOk(join(dest, 'homebox.db'))).toBe(true)
  })

  it('refuses to download, restore or delete a backup that is not completed', async () => {
    const id = randomUUID()
    mkdirSync(join(dataDir, 'backups'), { recursive: true })
    writeFileSync(join(dataDir, 'backups', `${id}.json`), JSON.stringify({ id, status: 'running', createdAt: new Date().toISOString() }))
    // Plant a stale `completed` sidecar with no archive beside it.
    const orphan = randomUUID()
    writeFileSync(join(dataDir, 'backups', `${orphan}.json`), JSON.stringify({ id: orphan, status: 'completed', createdAt: new Date().toISOString() }))

    expect((await app.inject({ method: 'GET', url: `/backups/${id}/download`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url: `/backups/${id}`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: `/backups/${orphan}/download`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/backups/${id}/restore`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'POST', url: `/backups/${orphan}/restore`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
  })

  it('answers 404 for an unknown id, never 409: "never existed" is not "not ready"', async () => {
    // A well-formed UUID with no sidecar at all: `isBackupId` passes, so this is
    // "unknown", not "malformed" — and it must not be reported as the 409 that
    // means "exists but is not completed", which is the whole point of the gating.
    const unknown = randomUUID()
    expect((await app.inject({ method: 'GET', url: `/backups/${unknown}/download`, headers: { cookie: adminCookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/backups/${unknown}`, headers: { cookie: adminCookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/backups/${unknown}/restore`, headers: { cookie: adminCookie } })).statusCode).toBe(404)
  })

  it('deletes a stored backup, removing both files', async () => {
    const { id } = await createBackupRow(adminCookie)
    const res = await app.inject({ method: 'DELETE', url: `/backups/${id}`, headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(existsSync(join(dataDir, 'backups', `${id}.tar.gz`))).toBe(false)
    expect(existsSync(join(dataDir, 'backups', `${id}.json`))).toBe(false)
    expect((await app.inject({ method: 'DELETE', url: `/backups/${id}`, headers: { cookie: adminCookie } })).statusCode).toBe(404)
  })

  it('rejects a path-traversal id on every :id route as 404', async () => {
    const evil = encodeURIComponent('../../etc/passwd')
    expect((await app.inject({ method: 'GET', url: `/backups/${evil}/download`, headers: { cookie: adminCookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/backups/${evil}`, headers: { cookie: adminCookie } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: `/backups/${evil}/restore`, headers: { cookie: adminCookie } })).statusCode).toBe(404)
  })

  it('no longer serves GET /backup', async () => {
    expect((await app.inject({ method: 'GET', url: '/backup', headers: { cookie: adminCookie } })).statusCode).toBe(404)
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

  it('createBackup writes the archive to destPath and leaves no temp dir behind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'homebox-svc-'))
    const srcData = join(root, 'data')
    mkdirSync(srcData, { recursive: true })
    const svcDbPath = join(root, 'svc.db')
    const svcDb = createDb(svcDbPath)
    runMigrations(svcDb)
    try {
      const before = tmpDirCount('homebox-backup-')
      const dest = join(root, 'out.tar.gz')
      await createBackup(svcDb, srcData, dest)
      expect(existsSync(dest)).toBe(true)
      const extracted = await extract(readFileSync(dest))
      expect(integrityOk(join(extracted, 'homebox.db'))).toBe(true)
      expect(existsSync(join(extracted, 'uploads'))).toBe(true)
      // Staging is disposable: the tar lands at destPath, tmp is emptied.
      expect(await waitFor(() => tmpDirCount('homebox-backup-') === before)).toBe(true)
    } finally {
      rawDb(svcDb).close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('createBackup leaves nothing at destPath when the archive cannot be written', async () => {
    const root = mkdtempSync(join(tmpdir(), 'homebox-svc-'))
    const srcData = join(root, 'data')
    mkdirSync(srcData, { recursive: true })
    const svcDb = createDb(join(root, 'svc.db'))
    runMigrations(svcDb)
    try {
      const before = tmpDirCount('homebox-backup-')
      // An unwritable destination: `tar` opens (and would create) the archive
      // file before writing members, so this is the ENOSPC-shaped failure a real
      // stored backup can hit — one that happens AFTER the destination exists. A
      // nonexistent parent dir would not do: `tar` refuses before creating
      // anything there, so nothing could be left behind either way.
      const dest = join(root, 'out.tar.gz')
      writeFileSync(dest, '')
      chmodSync(dest, 0o000)
      await expect(createBackup(svcDb, srcData, dest)).rejects.toThrow()
      // All-or-nothing: a truncated archive must not survive for a later reader.
      expect(existsSync(dest)).toBe(false)
      // Staging is disposable on the failure path too.
      expect(await waitFor(() => tmpDirCount('homebox-backup-') === before)).toBe(true)
    } finally {
      rawDb(svcDb).close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('POST /backups stores an archive and flips its sidecar to completed', async () => {
    const res = await app.inject({ method: 'POST', url: '/backups', headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(200)
    const { backup } = res.json()
    expect(backup.status).toBe('running')
    expect(backup.sizeBytes).toBeNull()
    expect(backup.id).toMatch(/^[0-9a-f-]{36}$/)

    // The row is durable before the response, so the sidecar already exists.
    const metaFile = join(dataDir, 'backups', `${backup.id}.json`)
    expect(existsSync(metaFile)).toBe(true)

    // The background job lands the archive and rewrites the sidecar.
    const archive = join(dataDir, 'backups', `${backup.id}.tar.gz`)
    expect(await waitFor(() => existsSync(archive))).toBe(true)
    expect(await waitFor(() => (JSON.parse(readFileSync(metaFile, 'utf8')) as { status: string }).status === 'completed')).toBe(true)

    // And it is a real archive.
    const dest = await extract(readFileSync(archive))
    expect(integrityOk(join(dest, 'homebox.db'))).toBe(true)
    expect(existsSync(join(dest, 'uploads'))).toBe(true)
  })

  it('GET /backups lists stored backups newest first with a size', async () => {
    await createBackupRow(adminCookie)
    const res = await app.inject({ method: 'GET', url: '/backups', headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(200)
    const { backups } = res.json()
    expect(backups.length).toBeGreaterThanOrEqual(1)
    expect(backups[0].status).toBe('completed')
    expect(backups[0].sizeBytes).toBeGreaterThan(0)
    const times = backups.map((b: { createdAt: string }) => b.createdAt)
    expect([...times].sort().reverse()).toEqual(times)
  })

  it('refuses a second backup while one is already running', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/backups', headers: { cookie: adminCookie } }),
      app.inject({ method: 'POST', url: '/backups', headers: { cookie: adminCookie } }),
    ])
    // The first request holds the guard across real disk I/O, so the second
    // always observes it set.
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    // The winner's job is still running: wait it out, or the next test to create
    // a backup in this app can observe the guard and get a 409 of its own.
    const winner = (a.statusCode === 200 ? a : b).json().backup.id as string
    const metaFile = join(dataDir, 'backups', `${winner}.json`)
    expect(await waitFor(() => (JSON.parse(readFileSync(metaFile, 'utf8')) as { status: string }).status === 'completed')).toBe(true)
  })

  it('sweeps a leftover running sidecar to failed when the server boots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'homebox-sweep-'))
    const sweepDataDir = join(root, 'data')
    const backups = join(sweepDataDir, 'backups')
    mkdirSync(backups, { recursive: true })
    const id = randomUUID()
    const metaFile = join(backups, `${id}.json`)
    writeFileSync(metaFile, JSON.stringify({ id, status: 'running', createdAt: new Date().toISOString() }))
    const sweepDbPath = join(root, 'sweep.db')
    const sweepDb = createDb(sweepDbPath)
    runMigrations(sweepDb)
    const sweepApp = buildApp({ db: sweepDb, dataDir: sweepDataDir, dbPath: sweepDbPath })
    try {
      await sweepApp.ready()
      const flipped = await waitFor(() => (JSON.parse(readFileSync(metaFile, 'utf8')) as { status: string }).status === 'failed')
      expect(flipped).toBe(true)
    } finally {
      await sweepApp.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('gates the backup list routes: 401 unauthenticated, 403 non-admin', async () => {
    expect((await app.inject({ method: 'POST', url: '/backups' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/backups' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/backups', headers: { cookie: nonAdminCookie } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/backups', headers: { cookie: nonAdminCookie } })).statusCode).toBe(403)
  })

  it('restores the live data from a stored backup (row round-trip)', async () => {
    // Take a snapshot of the current state...
    const { id } = await createBackupRow(adminCookie)

    // ...diverge from it...
    const all = (await listItems(adminCookie)).json()?.result?.data?.items
    const orig = all.find((i: { name: string }) => i.name === 'Original')
    await app.inject({ method: 'POST', url: '/trpc/items.trash', headers: { cookie: adminCookie }, payload: { id: orig.id } })
    await app.inject({ method: 'POST', url: '/trpc/items.create', headers: { cookie: adminCookie }, payload: { name: 'RowChanged', itemTypeId, locationId: null, quantity: 1 } })
    expect(await itemNames(adminCookie)).toContain('RowChanged')
    expect(await itemNames(adminCookie)).not.toContain('Original')

    // ...then restore from the row, which validates without touching anything.
    const start = await app.inject({ method: 'POST', url: `/backups/${id}/restore`, headers: { cookie: adminCookie } })
    expect(start.statusCode).toBe(200)
    const { preview, restoreId } = start.json()
    expect(preview.itemCount).toBeGreaterThanOrEqual(1)
    expect(typeof restoreId).toBe('string')
    // Still diverged: validation applied nothing.
    expect(await itemNames(adminCookie)).toContain('RowChanged')

    // Confirming goes through the unchanged endpoint.
    const restore = await app.inject({ method: 'POST', url: '/backup/restore', headers: { cookie: adminCookie }, payload: { restoreId } })
    expect(restore.statusCode).toBe(200)
    expect(restore.json()).toEqual({ ok: true })
    expect(await itemNames(adminCookie)).toContain('Original')
    expect(await itemNames(adminCookie)).not.toContain('RowChanged')

    // The backup that was restored FROM still exists: metadata lives beside the
    // files, so replacing homebox.db cannot erase the list (ADR-0006).
    const list = await app.inject({ method: 'GET', url: '/backups', headers: { cookie: adminCookie } })
    expect((list.json().backups as Array<{ id: string }>).some((b) => b.id === id)).toBe(true)
  })

  it('rejects a stored restore whose archive is unreadable, leaving the DB untouched', async () => {
    const { id } = await createBackupRow(adminCookie)
    // Corrupt the archive in place. The sidecar still says `completed` and the
    // file still exists, so this passes every gate ABOVE validation — only
    // `validateBackup` can catch it. Same 400 class as the upload path, which is
    // covered; this branch is not.
    writeFileSync(join(dataDir, 'backups', `${id}.tar.gz`), 'this is not a gzip archive')
    const dirsBefore = tmpDirCount('homebox-restore-')
    const itemsBefore = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    const res = await app.inject({ method: 'POST', url: `/backups/${id}/restore`, headers: { cookie: adminCookie } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'invalid backup archive' })
    const itemsAfter = (await listItems(adminCookie)).json()?.result?.data?.items?.length
    expect(itemsAfter).toBe(itemsBefore)
    // A rejected archive must not leak its temp dir (extraction + mkdtemp base).
    expect(await waitFor(() => tmpDirCount('homebox-restore-') === dirsBefore)).toBe(true)
  })
})
