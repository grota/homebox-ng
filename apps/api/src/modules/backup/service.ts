import { existsSync } from 'node:fs'
import { cp, copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { createDb, runMigrations, instanceSettings, items, users } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { DbHolder } from '../../context.js'

const exec = promisify(execFile)

// Access the raw better-sqlite3 driver the drizzle wrapper hides (needed for
// `.backup()`, `.close()`, `.pragma()`).
const rawDb = (db: DrizzleDb) =>
  (db as unknown as { $client: { backup: (d: string) => Promise<void>; close: () => void; pragma: (s: string) => void } }).$client

// Build `tmp/uploads` (copy of the live tree) then tar it with the dump at the
// archive root: layout = `homebox.db` + `uploads/…`. Returns the archive path,
// the temp base dir (so the route can remove the whole tree on the download
// path), and size. On success the caller removes `baseDir`; on a failure here we
// clean up the temp dir ourselves so we never leak `tmp`.
export const createBackup = async (db: DrizzleDb, dataDir: string): Promise<{ archivePath: string; baseDir: string; size: number }> => {
  const tmp = await mkdtemp(join(tmpdir(), 'homebox-backup-'))
  try {
    const dump = join(tmp, 'homebox.db')
    await rawDb(db).backup(dump) // safe: handles WAL, produces a standalone file
    // Only include the uploads tree if it exists (a fresh install may have none).
    try { await cp(join(dataDir, 'uploads'), join(tmp, 'uploads'), { recursive: true }) } catch { /* no uploads yet */ }
    // Guarantee `tmp/uploads` exists so `tar` never fails on a backup whose live
    // uploads tree is absent (a fresh install) — an empty dir keeps the layout stable.
    await mkdir(join(tmp, 'uploads'), { recursive: true }).catch(() => {})
    const archive = join(tmp, `backup-${randomUUID()}.tar.gz`)
    await exec('tar', ['-czf', archive, 'homebox.db', 'uploads'], { cwd: tmp })
    return { archivePath: archive, baseDir: tmp, size: (await stat(archive)).size }
  } catch (err) {
    // Backup creation failed partway (bad dump, tar error). Don't leak the temp
    // dir (which holds the uploads copy + dump). Errors are swallowed: nothing
    // was served, but the caller gets the original failure.
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

// Reject an archive whose members would escape `destDir`. GNU and BSD tar strip
// absolute/`..` members inconsistently, so safety cannot rely on tar's defaults.
// We pre-list members with `tar -tzf` and inspect names before extracting: a
// member is unsafe if it is absolute, contains a `..` segment, a backslash, or a
// null byte. Runs before any filesystem write, so the live tree is never touched
// and a rejected archive is surfaced as a client error (the route's 400 path).
const assertArchiveMembersSafe = async (archivePath: string): Promise<void> => {
  const { stdout } = await exec('tar', ['-tzf', archivePath])
  for (const raw of stdout.split('\n')) {
    const member = raw.trim().replace(/\/$/, '')
    if (!member) continue
    if (member.startsWith('/') || member.includes('\\') || member.includes('\0') || member.split('/').includes('..')) {
      throw new Error(`unsafe archive member: ${raw.trim()}`)
    }
  }
}

// Validate an uploaded archive by extracting to `destDir` and opening the dump;
// applies nothing. Returns a preview + a restoreId the route keeps in a Map.
export const validateBackup = async (archivePath: string, destDir: string) => {
  // Path-traversal guard: reject an archive whose members would escape `destDir`
  // before we touch the filesystem (see `assertArchiveMembersSafe`).
  await assertArchiveMembersSafe(archivePath)
  await rm(destDir, { recursive: true, force: true })
  await mkdir(destDir, { recursive: true })
  await exec('tar', ['-xzf', archivePath, '-C', destDir])
  const dump = join(destDir, 'homebox.db')
  const check = createDb(dump)
  try {
    const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (integrity?.integrity_check !== 'ok') throw new Error('invalid backup: db integrity check failed')
    const is = check.select().from(instanceSettings).limit(1).get()
    const userCount = (check.prepare('select count(*) as n from users').get() as { n: number }).n
    const itemCount = (check.prepare('select count(*) as n from items').get() as { n: number }).n
    return {
      preview: {
        dbBytes: (await stat(dump)).size,
        uploadCount: await countFiles(join(destDir, 'uploads')),
        maxUploadMb: is?.maxUploadMb ?? 10,
        userCount: Number(userCount),
        itemCount: Number(itemCount),
      },
      restoreId: randomUUID(),
    }
  } finally {
    rawDb(check).close()
  }
}

// Apply a validated extraction (already at `destDir`) to the live data: close the
// old connection, swap the dump + uploads tree, reopen. Destructive. `dbPath` is
// optional (typed `string | undefined`) because uploads routes thread it through
// from an optional `BuildAppOptions`; a falsy value is rejected up front.
export const applyRestore = async (holder: DbHolder, destDir: string, dbPath: string | undefined, dataDir: string): Promise<void> => {
  if (!dbPath) throw new Error('restore requires a file-backed database path')
  const old = holder.current
  rawDb(old).pragma('wal_checkpoint(TRUNCATE)')
  rawDb(old).close()
  try {
    await copyFile(join(destDir, 'homebox.db'), dbPath)
    for (const ext of ['-wal', '-shm']) await rm(dbPath + ext, { force: true })
    // Restore = the instance becomes exactly the backup. Wipe the live uploads tree,
    // then copy the archive's tree (guarded: a backup may have no `uploads/` such as
    // a fresh install). Filesystem-only — safe to run after `copyFile` while inside
    // the try.
    await rm(join(dataDir, 'uploads'), { recursive: true, force: true })
    if (existsSync(join(destDir, 'uploads'))) {
      await cp(join(destDir, 'uploads'), join(dataDir, 'uploads'), { recursive: true })
    }
    await mkdir(join(dataDir, 'uploads'), { recursive: true })
    const fresh = createDb(dbPath)
    runMigrations(fresh)
    holder.current = fresh
  } catch (err) {
    // Never leave a closed handle: best-effort reopen; fall back to a live
    // in-memory db so the API keeps serving rather than 500ing on every call.
    try { holder.current = createDb(dbPath) } catch { holder.current = createDb(':memory:') }
    throw err
  }
}

const countFiles = async (dir: string): Promise<number> => {
  try {
    const { readdir } = await import('node:fs/promises')
    return (await readdir(dir, { recursive: true })).length
  } catch {
    return 0
  }
}
