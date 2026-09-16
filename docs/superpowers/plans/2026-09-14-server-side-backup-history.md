# Server-Side Backup History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backups are created and stored on the server and listed in the admin tab as a table (Created / Status / Size), where each row can be downloaded, restored directly, or deleted — while the existing "restore from an uploaded archive" path keeps working unchanged.

**Architecture:** Each backup is a pair of files in `data/backups/` — `<uuid>.tar.gz` plus a `<uuid>.json` sidecar holding `{ id, status, createdAt, error? }`. The filesystem is the source of truth; size comes from `stat()` at read time. Creating a backup writes the `running` sidecar durably, returns immediately, and finishes in an in-process promise that rewrites the sidecar to `completed` or `failed`. A boot-time sweep marks any leftover `running` sidecar as `failed`. No database table and no migration — restoring replaces `homebox.db` wholesale, so a table would roll back with it (ADR-0006).

**Tech Stack:** TypeScript, Fastify (raw routes, not tRPC), `node:fs/promises`, `tar`/`gzip` via `execFile`, React 19 + i18next, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-server-side-backups-design.md`
**Decision record:** `docs/adr/0006-backup-history-lives-beside-its-archives.md`

## Global Constraints

- **No schema change and no migration.** Backup metadata is never stored in the database.
- **Archive layout is unchanged:** `homebox.db` + `uploads/` at the archive root. `data/backups/` is outside `uploads/`, so backups never nest.
- **Every new route is admin-gated** with the existing `admin()` helper in `backupRoutes.ts`: `401` unauthenticated, `403` non-admin.
- **`:id` is a trust boundary.** It is validated with `isBackupId` against a strict UUID pattern before any path is built. Never `join()` an unvalidated id.
- **No polling in the frontend.** The tab refetches on mount and after each mutation, never on a timer.
- **Status gating:** Download and Restore are legal only on `completed` rows; the routes return `409` if called otherwise, rather than trusting the UI to have hidden them.
- **Archive filename on download:** `homebox-backup-<YYYY-MM-DDTHH-mm-ss>.tar.gz`, derived from `createdAt`.
- Error copy and labels are i18n keys under `admin.backup.*` in `apps/web/src/locales/en/admin.json`. No hard-coded user-facing strings.

## Before you start

This is a fresh worktree with no dependencies installed, on Node 26. A plain `pnpm install` runs native builds (`argon2`, `sharp`) that fail here; skip scripts and build the workspace packages the API imports.

```bash
pnpm install --ignore-scripts
pnpm --filter @homebox/shared build
pnpm --filter @homebox/db build
```

Run the API suite with `pnpm --filter @homebox/api test`, or one file with:

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts
```

---

### Task 1: The backup metadata store

A new module with one responsibility: reading and writing backup metadata on disk. No Fastify, no database — this is the only place that knows the layout of `data/backups/`, so everything else asks it questions.

**Files:**
- Create: `apps/api/src/modules/backup/store.ts`
- Test: `apps/api/test/backupStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BackupStatus = 'running' | 'completed' | 'failed'`
  - `type BackupMeta = { id: string; status: BackupStatus; createdAt: string; error?: string }`
  - `type BackupRow = BackupMeta & { sizeBytes: number | null }`
  - `type DeleteResult = 'deleted' | 'not-found' | 'running'`
  - `backupsDir(dataDir: string): string`
  - `archivePath(dataDir: string, id: string): string`
  - `isBackupId(id: string): boolean`
  - `writeBackupMeta(dataDir: string, meta: BackupMeta): Promise<void>`
  - `readBackupMeta(dataDir: string, id: string): Promise<BackupMeta | null>`
  - `listBackups(dataDir: string): Promise<BackupRow[]>`
  - `deleteBackup(dataDir: string, id: string): Promise<DeleteResult>`
  - `sweepRunningToFailed(dataDir: string): Promise<number>`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/backupStore.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  archivePath,
  backupsDir,
  deleteBackup,
  isBackupId,
  listBackups,
  readBackupMeta,
  sweepRunningToFailed,
  writeBackupMeta,
} from '../src/modules/backup/store'

let root: string
const dataDir = () => join(root, 'data')

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'homebox-store-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const plantArchive = (id: string, bytes = 'archive-bytes') => {
  mkdirSync(backupsDir(dataDir()), { recursive: true })
  writeFileSync(archivePath(dataDir(), id), bytes)
}

describe('backup store', () => {
  it('accepts only well-formed UUIDs as ids', () => {
    expect(isBackupId(randomUUID())).toBe(true)
    expect(isBackupId('../../etc/passwd')).toBe(false)
    expect(isBackupId('a/b')).toBe(false)
    expect(isBackupId('')).toBe(false)
    expect(isBackupId('not-a-uuid')).toBe(false)
  })

  it('round-trips metadata', async () => {
    const id = randomUUID()
    await writeBackupMeta(dataDir(), { id, status: 'running', createdAt: '2026-09-14T07:22:20.000Z' })
    const meta = await readBackupMeta(dataDir(), id)
    expect(meta).toEqual({ id, status: 'running', createdAt: '2026-09-14T07:22:20.000Z' })
  })

  it('refuses to read an id that is not a UUID', async () => {
    expect(await readBackupMeta(dataDir(), '../../etc/passwd')).toBeNull()
  })

  it('lists nothing when the store does not exist yet', async () => {
    expect(await listBackups(dataDir())).toEqual([])
  })

  it('derives size from the archive and orders newest first', async () => {
    const older = randomUUID()
    const newer = randomUUID()
    plantArchive(older, 'x'.repeat(10))
    plantArchive(newer, 'y'.repeat(30))
    await writeBackupMeta(dataDir(), { id: older, status: 'completed', createdAt: '2026-09-01T00:00:00.000Z' })
    await writeBackupMeta(dataDir(), { id: newer, status: 'completed', createdAt: '2026-09-14T00:00:00.000Z' })
    const rows = await listBackups(dataDir())
    expect(rows.map((r) => r.id)).toEqual([newer, older])
    expect(rows[0].sizeBytes).toBe(30)
    expect(rows[1].sizeBytes).toBe(10)
  })

  it('reports a completed sidecar with no archive as failed', async () => {
    const id = randomUUID()
    await writeBackupMeta(dataDir(), { id, status: 'completed', createdAt: '2026-09-14T00:00:00.000Z' })
    const [row] = await listBackups(dataDir())
    expect(row.status).toBe('failed')
    expect(row.error).toBe('archive missing')
    expect(row.sizeBytes).toBeNull()
  })

  it('deletes both files, and refuses an unknown or running backup', async () => {
    const id = randomUUID()
    plantArchive(id)
    await writeBackupMeta(dataDir(), { id, status: 'completed', createdAt: '2026-09-14T00:00:00.000Z' })
    expect(await deleteBackup(dataDir(), id)).toBe('deleted')
    expect(existsSync(archivePath(dataDir(), id))).toBe(false)
    expect(await readBackupMeta(dataDir(), id)).toBeNull()
    expect(await deleteBackup(dataDir(), id)).toBe('not-found')
    expect(await deleteBackup(dataDir(), '../../etc/passwd')).toBe('not-found')

    const running = randomUUID()
    plantArchive(running)
    await writeBackupMeta(dataDir(), { id: running, status: 'running', createdAt: '2026-09-14T00:00:00.000Z' })
    expect(await deleteBackup(dataDir(), running)).toBe('running')
    expect(existsSync(archivePath(dataDir(), running))).toBe(true)
  })

  it('sweeps a running sidecar to failed and leaves completed ones alone', async () => {
    const running = randomUUID()
    const done = randomUUID()
    await writeBackupMeta(dataDir(), { id: running, status: 'running', createdAt: '2026-09-14T00:00:00.000Z' })
    plantArchive(done)
    await writeBackupMeta(dataDir(), { id: done, status: 'completed', createdAt: '2026-09-14T00:00:00.000Z' })
    expect(await sweepRunningToFailed(dataDir())).toBe(1)
    expect((await readBackupMeta(dataDir(), running))?.status).toBe('failed')
    expect((await readBackupMeta(dataDir(), running))?.error).toBe('interrupted')
    expect((await readBackupMeta(dataDir(), done))?.status).toBe('completed')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/api exec vitest run test/backupStore.test.ts
```

Expected: FAIL — `Cannot find module '../src/modules/backup/store'`.

- [ ] **Step 3: Write the store**

Create `apps/api/src/modules/backup/store.ts`:

```ts
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type BackupStatus = 'running' | 'completed' | 'failed'

/** What the sidecar records. Size is deliberately absent — see `listBackups`. */
export type BackupMeta = {
  id: string
  status: BackupStatus
  createdAt: string
  error?: string
}

/** A sidecar plus the one fact only the filesystem knows. */
export type BackupRow = BackupMeta & { sizeBytes: number | null }

export type DeleteResult = 'deleted' | 'not-found' | 'running'

export const backupsDir = (dataDir: string): string => join(dataDir, 'backups')

export const archivePath = (dataDir: string, id: string): string =>
  join(backupsDir(dataDir), `${id}.tar.gz`)

const metaPath = (dataDir: string, id: string): string => join(backupsDir(dataDir), `${id}.json`)

// An id is interpolated into a filesystem path, so this is a trust boundary:
// only a well-formed UUID (what we generate) may reach the filesystem. Anything
// else — `../../etc/passwd`, a separator, a NUL — cannot match the pattern, so
// it is rejected before any path is built. Callers turn `false` into a 404.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isBackupId = (id: string): boolean => UUID_RE.test(id)

// Written to a temp name and renamed into place so a reader never sees a
// half-written sidecar, and fsynced before the rename so a row the route has
// already returned cannot be lost by a crash. (Full durability would also fsync
// the directory; the file's own contents are what the row promises.)
export const writeBackupMeta = async (dataDir: string, meta: BackupMeta): Promise<void> => {
  await mkdir(backupsDir(dataDir), { recursive: true })
  const dest = metaPath(dataDir, meta.id)
  const tmp = `${dest}.tmp`
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(JSON.stringify(meta, null, 2))
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmp, dest)
}

export const readBackupMeta = async (dataDir: string, id: string): Promise<BackupMeta | null> => {
  if (!isBackupId(id)) return null
  try {
    return JSON.parse(await readFile(metaPath(dataDir, id), 'utf8')) as BackupMeta
  } catch {
    return null
  }
}

export const listBackups = async (dataDir: string): Promise<BackupRow[]> => {
  let names: string[]
  try {
    names = await readdir(backupsDir(dataDir))
  } catch {
    return [] // no store yet (a fresh install)
  }
  const rows: BackupRow[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp')) continue
    const id = name.slice(0, -'.json'.length)
    const meta = await readBackupMeta(dataDir, id)
    if (!meta) continue
    // Size is read here rather than stored, so it can never disagree with disk.
    let sizeBytes: number | null = null
    try { sizeBytes = (await stat(archivePath(dataDir, id))).size } catch { sizeBytes = null }
    let { status, error } = meta
    // A sidecar claiming `completed` with no archive beside it is the two files
    // disagreeing (one deleted by hand). Report it as failed so a row never
    // offers a download that cannot be served.
    if (status === 'completed' && sizeBytes === null) {
      status = 'failed'
      error = 'archive missing'
    }
    rows.push({ id, status, createdAt: meta.createdAt, error, sizeBytes })
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return rows
}

export const deleteBackup = async (dataDir: string, id: string): Promise<DeleteResult> => {
  if (!isBackupId(id)) return 'not-found'
  const meta = await readBackupMeta(dataDir, id)
  if (!meta) return 'not-found'
  // Removing the file under a live tar would race the writer.
  if (meta.status === 'running') return 'running'
  await rm(archivePath(dataDir, id), { force: true })
  await rm(metaPath(dataDir, id), { force: true })
  return 'deleted'
}

// Nothing can be mid-backup before the process starts, so a `running` sidecar
// found at boot belongs to a process that died. Exact, not a timeout heuristic.
export const sweepRunningToFailed = async (dataDir: string): Promise<number> => {
  let names: string[]
  try {
    names = await readdir(backupsDir(dataDir))
  } catch {
    return 0
  }
  let swept = 0
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp')) continue
    const id = name.slice(0, -'.json'.length)
    const meta = await readBackupMeta(dataDir, id)
    if (!meta || meta.status !== 'running') continue
    await writeBackupMeta(dataDir, { ...meta, status: 'failed', error: 'interrupted' })
    swept++
  }
  return swept
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/api exec vitest run test/backupStore.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/backup/store.ts apps/api/test/backupStore.test.ts
git commit -m "feat(api): backup metadata store backed by sidecar files"
```

---

### Task 2: `createBackup` writes to a destination path

`createBackup` currently builds the archive inside a temp dir and returns the path so the route can delete it. It becomes a function that stages the dump and uploads copy in a temp dir but tars the result **straight to a caller-supplied path**, cleaning up staging on every exit. This is what lets a stored backup never exist in temp at all.

`GET /backup` is updated to the new signature here (keeping its behaviour identical) and deleted in Task 4, so the suite never goes red in between.

**Files:**
- Modify: `apps/api/src/modules/backup/service.ts:24-44`
- Modify: `apps/api/src/modules/backup/backupRoutes.ts:46-57`
- Test: `apps/api/test/backup.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `createBackup(db: DrizzleDb, dataDir: string, destPath: string): Promise<void>` — replaces the old `Promise<{ archivePath, baseDir, size }>`. `destPath` **must be absolute**: `tar` runs with the staging dir as its cwd.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/backup.test.ts`, inside the existing `describe('backup & restore', ...)` block. Add `createBackup` to the imports from `../src/modules/backup/service` (there are none today — add a new import line).

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts -t "createBackup writes the archive to destPath"
```

Expected: FAIL — `createBackup` still takes two arguments, so `dest` is ignored and no file appears at it.

- [ ] **Step 3: Rewrite `createBackup`**

In `apps/api/src/modules/backup/service.ts`, replace lines 19-44 (the comment block and `createBackup`) with:

```ts
// Stage the dump and an uploads copy in a disposable temp dir, then tar the two
// entries (layout = `homebox.db` + `uploads/`) straight to `destPath`. Staging
// is removed on every exit path, so nothing leaks into tmp. `destPath` must be
// absolute — `tar` runs with the staging dir as its cwd.
export const createBackup = async (db: DrizzleDb, dataDir: string, destPath: string): Promise<void> => {
  const staging = await mkdtemp(join(tmpdir(), 'homebox-backup-'))
  try {
    const dump = join(staging, 'homebox.db')
    await rawDb(db).backup(dump) // safe: handles WAL, produces a standalone file
    // Only include the uploads tree if it exists (a fresh install may have none).
    try { await cp(join(dataDir, 'uploads'), join(staging, 'uploads'), { recursive: true }) } catch { /* no uploads yet */ }
    // Guarantee `staging/uploads` exists so `tar` never fails on a backup whose
    // live uploads tree is absent (a fresh install) — an empty dir keeps the
    // layout stable.
    await mkdir(join(staging, 'uploads'), { recursive: true }).catch(() => {})
    await exec('tar', ['-czf', destPath, 'homebox.db', 'uploads'], { cwd: staging })
  } finally {
    // Best-effort: the archive is already at `destPath`, so a staging cleanup
    // failure must not fail the backup.
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}
```

Then drop the now-unused `stat` from the `node:fs/promises` import on line 2 — it becomes:

```ts
import { cp, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
```

- [ ] **Step 4: Update the `GET /backup` call site so the suite still compiles**

In `apps/api/src/modules/backup/backupRoutes.ts`, replace the `GET /backup` handler (lines 45-57) with:

```ts
  // Download a fresh backup archive. (Deleted in the next task — a stored
  // backup's own download route replaces it.)
  app.get('/backup', async (req, reply) => {
    if (!admin(req, reply)) return
    const tmp = await mkdtemp(join(tmpdir(), 'homebox-backup-'))
    const archive = join(tmp, 'backup.tar.gz')
    try {
      await createBackup(dbHolder.current, dataDir, archive)
    } catch (err) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
      throw err
    }
    reply.header('Content-Type', 'application/gzip')
    reply.header('Content-Disposition', 'attachment; filename="homebox-backup.tar.gz"')
    const stream = createReadStream(archive)
    // Remove the temp dir (dump + uploads copy + archive) once the download
    // finishes. Errors are swallowed: the archive was already served, so a
    // cleanup failure must not break the response.
    stream.on('close', () => void rm(tmp, { recursive: true, force: true }).catch(() => {}))
    return reply.send(stream)
  })
```

- [ ] **Step 5: Run the whole API backup suite**

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts
```

Expected: PASS — the new test plus all pre-existing ones (including the temp-dir leak test, which still holds because `GET /backup` still stages under the same `homebox-backup-` prefix).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/backup/service.ts apps/api/src/modules/backup/backupRoutes.ts apps/api/test/backup.test.ts
git commit -m "refactor(api): createBackup writes to a given destination path"
```

---

### Task 3: Create and list routes

`POST /backups` starts a backup and returns immediately; `GET /backups` lists them. This task also installs the two guarantees the async design depends on: a single in-flight create (409 on a second), and the boot-time sweep.

**Files:**
- Modify: `apps/api/src/modules/backup/backupRoutes.ts`
- Test: `apps/api/test/backup.test.ts`

**Interfaces:**
- Consumes: `backupsDir`, `archivePath`, `listBackups`, `sweepRunningToFailed`, `writeBackupMeta` from `./store.js` (Task 1); `createBackup(db, dataDir, destPath)` (Task 2).
- Produces:
  - `POST /backups` → `200 { backup: { id, status: 'running', createdAt, sizeBytes: null } }`, or `409 { error: 'backup_in_progress' }`.
  - `GET /backups` → `200 { backups: BackupRow[] }`.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe` block in `apps/api/test/backup.test.ts`. Add `randomUUID` to the `node:crypto` import and `writeFileSync`/`readFileSync` are already imported.

```ts
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
```

Add this helper next to the existing `getBackup` helper (the tests above use it):

```ts
// Start a server-side backup and wait for the background job to finish.
const createBackupRow = async (cookie: string): Promise<{ id: string }> => {
  const res = await app.inject({ method: 'POST', url: '/backups', headers: { cookie } })
  expect(res.statusCode).toBe(200)
  const { backup } = res.json()
  const archive = join(dataDir, 'backups', `${backup.id}.tar.gz`)
  expect(await waitFor(() => existsSync(archive))).toBe(true)
  return { id: backup.id as string }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts -t "POST /backups"
```

Expected: FAIL — `404` from Fastify, the route does not exist.

- [ ] **Step 3: Add the routes**

In `apps/api/src/modules/backup/backupRoutes.ts`, add to the imports:

```ts
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { archivePath, listBackups, sweepRunningToFailed, writeBackupMeta } from './store.js'
```

Inside `registerBackupRoutes`, immediately after the `dropRestore` definition, add:

```ts
  // One create at a time: a create is a multi-megabyte tar plus a full uploads
  // copy, and two at once only fight for the same disk. In-process, not a lock
  // file — one process owns this directory (ADR-0006), which is also what makes
  // the boot sweep below exact rather than a heuristic.
  let creating = false

  // Nothing can be mid-backup before this process starts, so any `running`
  // sidecar on disk belongs to a process that died. Best-effort: a failure here
  // must not stop the server from booting.
  void sweepRunningToFailed(dataDir).catch(() => {})
```

Then add the two routes (place them after the `GET /backup` handler):

```ts
  // Start a stored backup. Returns as soon as the record is durable — the tar
  // itself runs in the background (see `runCreate`).
  app.post('/backups', async (req, reply) => {
    if (!admin(req, reply)) return
    if (creating) return reply.code(409).send({ error: 'backup_in_progress' })
    creating = true
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    try {
      // Durable BEFORE the response: the row the client is handed must exist on
      // disk, never be a projection of work that might not start.
      await writeBackupMeta(dataDir, { id, status: 'running', createdAt })
    } catch {
      creating = false
      return reply.code(500).send({ error: 'could not start backup' })
    }
    // ponytail: in-process promise, not a durable queue — if the API dies
    // mid-backup the archive is lost and the boot sweep marks the row failed.
    // Add a real worker only if backups must survive a restart (ADR-0006).
    void runCreate(id, createdAt)
    return { backup: { id, status: 'running', createdAt, sizeBytes: null } }
  })

  const runCreate = async (id: string, createdAt: string): Promise<void> => {
    try {
      await createBackup(dbHolder.current, dataDir, archivePath(dataDir, id))
      await writeBackupMeta(dataDir, { id, status: 'completed', createdAt })
    } catch (err) {
      // The failure must be visible in the list, not just in a log.
      await writeBackupMeta(dataDir, { id, status: 'failed', createdAt, error: (err as Error).message }).catch(() => {})
    } finally {
      creating = false
    }
  }

  // List stored backups, newest first.
  app.get('/backups', async (req, reply) => {
    if (!admin(req, reply)) return
    return { backups: await listBackups(dataDir) }
  })
```

Note: `runCreate` is referenced before its `const` declaration inside `app.post`. That is safe — the handler body runs long after the module has finished evaluating. If you prefer, declare `runCreate` above `app.post`; keep it in the same order if you move it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts
```

Expected: PASS — all tests, old and new.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/backup/backupRoutes.ts apps/api/test/backup.test.ts
git commit -m "feat(api): start a stored backup and list stored backups"
```

---

### Task 4: Download and delete routes, and the removal of `GET /backup`

`GET /backup` now has a replacement: a stored backup is downloaded from its own row. This task adds that route and the delete route, deletes `GET /backup`, and repoints the test helper so the existing round-trip tests keep working unchanged.

**Files:**
- Modify: `apps/api/src/modules/backup/backupRoutes.ts`
- Modify: `apps/api/test/backup.test.ts`

**Interfaces:**
- Consumes: `archivePath`, `deleteBackup`, `isBackupId`, `readBackupMeta` from `./store.js`.
- Produces:
  - `GET /backups/:id/download` → the gzip stream, `404` unknown id, `409` not completed.
  - `DELETE /backups/:id` → `200 { ok: true }`, `404` unknown id, `409` running.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/backup.test.ts`, **replace the body of the `getBackup` helper** (lines 80-85) so it sources bytes from a stored row instead of `GET /backup`. Its call sites and return type do not change — leave the `createBackupRow` helper added in Task 3 where it is:

```ts
// Same contract as before: create a backup, return its bytes. Now a stored row
// rather than a stream from the deleted `GET /backup`.
const getBackup = async (cookie: string): Promise<Buffer> => {
  const { id } = await createBackupRow(cookie)
  const res = await app.inject({ method: 'GET', url: `/backups/${id}/download`, headers: { cookie } })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toContain('application/gzip')
  return res.rawPayload
}
```

Then **delete the `does not leak the temp dir after GET /backup downloads an archive` test** (it asserted temp behaviour for a route that no longer exists) and replace it with:

```ts
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
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="homebox-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.tar\.gz"/)
    const dest = await extract(res.rawPayload)
    expect(integrityOk(join(dest, 'homebox.db'))).toBe(true)
  })

  it('refuses to download or delete a backup that is not completed', async () => {
    const id = randomUUID()
    mkdirSync(join(dataDir, 'backups'), { recursive: true })
    writeFileSync(join(dataDir, 'backups', `${id}.json`), JSON.stringify({ id, status: 'running', createdAt: new Date().toISOString() }))
    // Plant a stale `completed` sidecar with no archive beside it.
    const orphan = randomUUID()
    writeFileSync(join(dataDir, 'backups', `${orphan}.json`), JSON.stringify({ id: orphan, status: 'completed', createdAt: new Date().toISOString() }))

    expect((await app.inject({ method: 'GET', url: `/backups/${id}/download`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'DELETE', url: `/backups/${id}`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
    expect((await app.inject({ method: 'GET', url: `/backups/${orphan}/download`, headers: { cookie: adminCookie } })).statusCode).toBe(409)
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
```

Add `randomUUID` to the `node:crypto` import if Task 3 has not already.

Then update the 401/403 gating test to cover the new routes — replace the existing `gates every backup route` test body with:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts
```

Expected: FAIL — `/backups/:id/download` and `DELETE /backups/:id` return 404.

- [ ] **Step 3: Add the routes and delete `GET /backup`**

In `apps/api/src/modules/backup/backupRoutes.ts`, delete the entire `GET /backup` handler added in Task 2 and replace it with:

```ts
  // Download a stored backup. A plain GET so the browser can navigate to it and
  // let the `Content-Disposition` header do the naming.
  app.get('/backups/:id/download', async (req, reply) => {
    if (!admin(req, reply)) return
    const { id } = req.params as { id: string }
    if (!isBackupId(id)) return reply.code(404).send({ error: 'not found' })
    const meta = await readBackupMeta(dataDir, id)
    // Only a completed backup has an archive — `409`, never a 404, so a row that
    // exists but is not ready is distinguishable from one that never did.
    if (!meta || meta.status !== 'completed') return reply.code(409).send({ error: 'backup not ready' })
    const archive = archivePath(dataDir, id)
    if (!existsSync(archive)) return reply.code(409).send({ error: 'archive missing' })
    // `createdAt` is an ISO string; the filename gets the timestamp the old
    // fixed name never carried.
    const stamp = meta.createdAt.slice(0, 19).replace(/:/g, '-')
    reply.header('Content-Type', 'application/gzip')
    reply.header('Content-Disposition', `attachment; filename="homebox-backup-${stamp}.tar.gz"`)
    return reply.send(createReadStream(archive))
  })

  // Remove a stored backup: the archive and its sidecar.
  app.delete('/backups/:id', async (req, reply) => {
    if (!admin(req, reply)) return
    const { id } = req.params as { id: string }
    if (!isBackupId(id)) return reply.code(404).send({ error: 'not found' })
    const result = await deleteBackup(dataDir, id)
    if (result === 'not-found') return reply.code(404).send({ error: 'not found' })
    if (result === 'running') return reply.code(409).send({ error: 'backup_in_progress' })
    return { ok: true }
  })
```

Update the `./store.js` import line to add `deleteBackup`, `isBackupId`, `readBackupMeta`. The `mkdtemp`/`tmpdir`/`join` imports stay — the restore paths below still use them.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts
```

Expected: PASS. The round-trip test now exercises create → download → upload → confirm.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/backup/backupRoutes.ts apps/api/test/backup.test.ts
git commit -m "feat(api): download and delete stored backups; drop GET /backup"
```

---

### Task 5: Restore from a row

Restoring a stored backup must reuse the existing two-phase flow exactly — the same `validateBackup`, the same `{ preview, restoreId }`, the same `POST /backup/restore` confirm and 15-minute TTL. Only the source of bytes differs. This is what keeps the preview card and its "This replaces all current data." warning on the destructive path.

**Files:**
- Modify: `apps/api/src/modules/backup/backupRoutes.ts`
- Test: `apps/api/test/backup.test.ts`

**Interfaces:**
- Consumes: `archivePath`, `isBackupId`, `readBackupMeta`; `validateBackup` from `./service.js`; the existing `restoreDirs` map and `dropRestore`.
- Produces: `POST /backups/:id/restore` → `200 { preview, restoreId }`, `404` unknown id, `409` not completed, `400` unreadable archive. The returned `restoreId` is confirmed through the unchanged `POST /backup/restore`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe` block in `apps/api/test/backup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm --filter @homebox/api exec vitest run test/backup.test.ts -t "restores the live data from a stored backup"
```

Expected: FAIL — `404`, the restore route does not exist.

- [ ] **Step 3: Add the route**

In `apps/api/src/modules/backup/backupRoutes.ts`, add after the `DELETE /backups/:id` handler:

```ts
  // Phase 1 for a STORED backup: validate the archive already on disk. Same
  // contract as `POST /upload/backup` — returns a preview and a restoreId, and
  // applies nothing — so the confirm step and the preview card are shared.
  app.post('/backups/:id/restore', async (req, reply) => {
    if (!admin(req, reply)) return
    const { id } = req.params as { id: string }
    if (!isBackupId(id)) return reply.code(404).send({ error: 'not found' })
    const meta = await readBackupMeta(dataDir, id)
    if (!meta || meta.status !== 'completed') return reply.code(409).send({ error: 'backup not ready' })
    const archive = archivePath(dataDir, id)
    if (!existsSync(archive)) return reply.code(409).send({ error: 'archive missing' })

    // The archive stays where it is — only the extraction is temporary, so a
    // failed validation never endangers the stored backup.
    const tmp = await mkdtemp(join(tmpdir(), 'homebox-restore-'))
    const dest = join(tmp, 'extract')
    try {
      const { preview, restoreId } = await validateBackup(archive, dest)
      restoreDirs.set(restoreId, dest)
      const timer = setTimeout(() => dropRestore(restoreId, dest), RESTORE_TTL_MS)
      timer.unref()
      restoreDirsTimers.set(restoreId, timer)
      return { preview, restoreId }
    } catch {
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
      return reply.code(400).send({ error: 'invalid backup archive' })
    }
  })
```

- [ ] **Step 4: Run the whole API suite**

```bash
pnpm --filter @homebox/api test
```

Expected: PASS — the new round-trip plus everything already there. Run the full suite, not just the backup file, because `service.ts` and `backupRoutes.ts` are imported by `server.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/backup/backupRoutes.ts apps/api/test/backup.test.ts
git commit -m "feat(api): restore the live data from a stored backup"
```

---

### Task 6: The admin tab, and the e2e that drives it

The UI becomes a table with three per-row actions. The upload field and its preview card are untouched.

**Files:**
- Modify: `apps/web/src/features/admin/AdminBackupTab.tsx` (whole file)
- Modify: `apps/web/src/locales/en/admin.json`
- Modify: `apps/web/e2e/admin.spec.ts:91-115`

**Interfaces:**
- Consumes: the routes from Tasks 3-5.
- Produces: nothing later tasks depend on — this is the last task.

- [ ] **Step 1: Add the locale keys**

In `apps/web/src/locales/en/admin.json`, replace the whole `"backup": { ... }` block with:

```json
    "backup": {
      "title": "Backup & restore",
      "create": "Create backup",
      "created": "Created",
      "status": "Status",
      "size": "Size",
      "actions": "Actions",
      "download": "Download",
      "restore": "Restore",
      "delete": "Delete",
      "empty": "No backups yet.",
      "started": "Backup started — refresh to see it finish.",
      "deleted": "Backup deleted.",
      "createFailed": "Could not start the backup.",
      "deleteFailed": "Delete failed.",
      "loadFailed": "Could not load backups.",
      "statusLabel": {
        "running": "running",
        "completed": "completed",
        "failed": "failed"
      },
      "uploadLabel": "Restore from a backup archive",
      "preview": "Backup preview",
      "previewDetail": "{users} users · {items} items · {uploads} uploads · max {mb} MB",
      "confirm": "Restore this backup",
      "cancel": "Cancel",
      "replaceWarning": "This replaces all current data.",
      "restored": "Restore complete.",
      "restoreFailed": "Restore failed.",
      "uploadFailed": "Upload failed."
    },
```

(`downloadFailed` is gone: the row download is a plain navigation the browser owns, so there is no failure to catch.)

- [ ] **Step 2: Rewrite the tab**

Replace `apps/web/src/features/admin/AdminBackupTab.tsx` entirely:

```tsx
import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Card, Field, Input } from '../../ui'

type BackupPreview = {
  dbBytes: number
  uploadCount: number
  maxUploadMb: number
  userCount: number
  itemCount: number
}

type BackupStatus = 'running' | 'completed' | 'failed'

type BackupRow = {
  id: string
  status: BackupStatus
  createdAt: string
  error?: string
  sizeBytes: number | null
}

// Sizes and counts come back as bytes; the table shows MB (rounding to 1 KB
// below that, so a tiny instance does not read as "0 MB").
const formatSize = (bytes: number | null): string => {
  if (bytes === null) return '—'
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

// Backup & restore. These are raw `fetch` endpoints (not tRPC):
//   POST   /backups              → { backup } — starts a server-side backup.
//   GET    /backups              → { backups }
//   GET    /backups/:id/download → the archive (navigated to, not fetched).
//   DELETE /backups/:id          → { ok: true }
//   POST   /backups/:id/restore  → { preview, restoreId } (non-destructive).
//   POST   /upload/backup        → multipart file → { preview, restoreId }.
//   POST   /backup/restore       → { restoreId } → { ok: true } (destructive).
export function AdminBackupTab() {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/backups')
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as { backups: BackupRow[] }
      setBackups(data.backups)
    } catch {
      setError(t('admin.backup.loadFailed'))
    }
  }, [t])

  useEffect(() => { void load() }, [load])

  // No polling by design: the backup runs server-side and the admin refreshes
  // when they care. The message says so rather than implying live progress.
  const create = async () => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/backups', { method: 'POST' })
      if (!res.ok) throw new Error('bad status')
      setMessage(t('admin.backup.started'))
      await load()
    } catch {
      setError(t('admin.backup.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  // A navigation, not a fetch: the endpoint sets `Content-Disposition`, so the
  // browser names and saves the file for us.
  const download = (row: BackupRow) => {
    const a = document.createElement('a')
    a.href = `/backups/${row.id}/download`
    a.click()
  }

  const remove = async (row: BackupRow) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch(`/backups/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('bad status')
      setMessage(t('admin.backup.deleted'))
      await load()
    } catch {
      setError(t('admin.backup.deleteFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Non-destructive: opens the same preview card the upload path uses.
  const startRestore = async (row: BackupRow) => {
    setBusy(true)
    setError(null)
    setMessage(null)
    setPreview(null)
    setRestoreId(null)
    try {
      const res = await fetch(`/backups/${row.id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as { preview: BackupPreview; restoreId: string }
      setPreview(data.preview)
      setRestoreId(data.restoreId)
    } catch {
      setError(t('admin.backup.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/upload/backup', { method: 'POST', body })
      if (!res.ok) throw new Error('bad status')
      const data = (await res.json()) as { preview: BackupPreview; restoreId: string }
      setPreview(data.preview)
      setRestoreId(data.restoreId)
    } catch {
      setError(t('admin.backup.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  const confirmRestore = async () => {
    if (!restoreId) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restoreId }),
      })
      if (!res.ok) throw new Error('bad status')
      setMessage(t('admin.backup.restored'))
      setPreview(null)
      setRestoreId(null)
    } catch {
      setError(t('admin.backup.restoreFailed'))
    } finally {
      setBusy(false)
    }
  }

  const cancelRestore = () => {
    setPreview(null)
    setRestoreId(null)
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">{t('admin.backup.title')}</h2>

      <div className="flex flex-col gap-4 max-w-[40rem]">
        <Button type="button" variant="primary" onClick={() => void create()} disabled={busy} className="w-fit">
          {t('admin.backup.create')}
        </Button>

        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-y border-border">
              <th scope="col" className="py-2 font-semibold">{t('admin.backup.created')}</th>
              <th scope="col" className="py-2 font-semibold">{t('admin.backup.status')}</th>
              <th scope="col" className="py-2 font-semibold">{t('admin.backup.size')}</th>
              <th scope="col" className="py-2 font-semibold text-right">{t('admin.backup.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((row) => {
              // Only a completed backup has an archive to serve or apply.
              const ready = row.status === 'completed'
              return (
                <tr key={row.id} className="border-b border-border">
                  <td className="py-2">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="py-2">{t(`admin.backup.statusLabel.${row.status}`)}</td>
                  <td className="py-2">{formatSize(row.sizeBytes)}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-3">
                      <button
                        type="button"
                        className="text-accent underline disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => download(row)}
                        disabled={!ready || busy}
                      >
                        {t('admin.backup.download')}
                      </button>
                      <button
                        type="button"
                        className="text-accent underline disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void startRestore(row)}
                        disabled={!ready || busy}
                      >
                        {t('admin.backup.restore')}
                      </button>
                      <button
                        type="button"
                        className="text-danger underline disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => void remove(row)}
                        disabled={busy}
                      >
                        {t('admin.backup.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {backups.length === 0 && <p className="text-text-muted">{t('admin.backup.empty')}</p>}

        <Field label={t('admin.backup.uploadLabel')} htmlFor="admin-backup-file">
          <Input
            id="admin-backup-file"
            type="file"
            accept=".tar.gz,application/gzip"
            onChange={(e) => void onFile(e)}
            disabled={busy}
          />
        </Field>

        {preview && (
          <Card>
            <p className="font-semibold">{t('admin.backup.preview')}</p>
            <p className="text-text-muted">
              {t('admin.backup.previewDetail', {
                users: preview.userCount,
                items: preview.itemCount,
                uploads: preview.uploadCount,
                mb: preview.maxUploadMb,
              })}
            </p>
            <p className="text-text-muted">{t('admin.backup.replaceWarning')}</p>
            <div className="flex gap-2 mt-2">
              <Button
                type="button"
                variant="danger"
                onClick={() => void confirmRestore()}
                disabled={busy || !restoreId}
              >
                {t('admin.backup.confirm')}
              </Button>
              <Button type="button" onClick={cancelRestore} disabled={busy}>
                {t('admin.backup.cancel')}
              </Button>
            </div>
          </Card>
        )}

        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck the web app**

```bash
pnpm --filter @homebox/web typecheck
```

Expected: no errors.

- [ ] **Step 4: Update the e2e**

In `apps/web/e2e/admin.spec.ts`, replace the `admin downloads a backup and restores it (round-trip)` test (lines 91-115) with:

```ts
test('admin creates a stored backup, downloads it, and restores it', async ({ page }) => {
  await loginAdmin(page)

  await page.goto('/admin')
  await page.getByRole('tab', { name: 'Backup & restore' }).click()

  // Create: stored server-side, and the tab says to refresh rather than polling.
  await page.getByRole('button', { name: 'Create backup' }).click()
  await expect(page.getByRole('status')).toHaveText('Backup started — refresh to see it finish.')

  // There is no polling, so a reload is how the row reaches `completed`. The
  // selected tab is local React state (AdminPage), not a URL param, so every
  // reload drops back to Users and the tab must be re-opened each time.
  await expect(async () => {
    await page.reload()
    await page.getByRole('tab', { name: 'Backup & restore' }).click()
    await expect(page.getByRole('cell', { name: 'completed' })).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 20000 })

  // Download from the row (a real blob download).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).first().click(),
  ])
  const backupPath = test.info().outputPath('homebox-backup.tar.gz')
  await download.saveAs(backupPath)

  // The upload path is unchanged: non-destructive preview, then confirm.
  await page.setInputFiles('#admin-backup-file', backupPath)
  await expect(page.getByText('Backup preview')).toBeVisible()
  await expect(page.getByText('This replaces all current data.')).toBeVisible()
  await page.getByRole('button', { name: 'Restore this backup' }).click()
  await expect(page.getByRole('status')).toHaveText('Restore complete.')
})
```

`exact: true` matters: without it, `name: 'Download'` is a substring match and would also match nothing else today, but `name: 'Restore'` would ambiguously match the "Restore this backup" confirm button.

- [ ] **Step 5: Run the e2e**

The Playwright config boots its own stack: it runs `pnpm -r build`, then serves the built API + SPA on port **3100** against a fresh temp database per run. It does not touch the dev servers on 3000/5173, so nothing needs stopping. Override with `E2E_PORT` if 3100 is occupied.

```bash
pnpm --filter @homebox/web test:e2e -- admin.spec.ts
```

Expected: PASS — create, refresh, download, upload, restore.

If the API fails to start with a native-module error (`argon2` or `sharp`), this worktree was installed with `--ignore-scripts` and those binaries were skipped. Build them and re-run:

```bash
pnpm rebuild argon2 sharp
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/admin/AdminBackupTab.tsx apps/web/src/locales/en/admin.json apps/web/e2e/admin.spec.ts
git commit -m "feat(web): list, download, restore and delete stored backups"
```

---

## Final verification

- [ ] `pnpm --filter @homebox/api test` — full API suite green.
- [ ] `pnpm --filter @homebox/web typecheck` — no type errors.
- [ ] `pnpm --filter @homebox/web test:e2e -- admin.spec.ts` — e2e green on spare ports.
- [ ] `pnpm --filter @homebox/web test` — web unit suite still green.
- [ ] Confirm by hand in the admin tab: create a backup, refresh, and see `completed` with a size; download it; restore from the row and check the preview card appears before anything is applied; delete a row and check both files leave `data/backups/`.
- [ ] Confirm `data/backups/` is absent from a freshly created archive's member list (`tar -tzf`), so backups cannot nest.
