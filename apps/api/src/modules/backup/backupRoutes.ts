import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseSessionCookie } from '../../context.js'
import type { DbHolder } from '../../context.js'
import type { Maintenance } from '../system/maintenance.js'
import { getSessionUser } from '../../auth/sessions.js'
import { createBackup, validateBackup, applyRestore } from './service.js'
import { archivePath, deleteBackup, isBackupId, listBackups, readBackupMeta, sweepRunningToFailed, writeBackupMeta } from './store.js'

// How long a validated-but-unconfirmed restore stays available before it is
// treated as abandoned and its temp dir is cleaned up.
const RESTORE_TTL_MS = 15 * 60 * 1000 // 15 minutes

export const registerBackupRoutes = (app: FastifyInstance, opts: { dbHolder: DbHolder; dataDir: string; dbPath?: string; maintenance: Maintenance }): void => {
  const { dbHolder, dataDir, dbPath, maintenance } = opts

  // Use the CURRENT db handle for auth, mirroring uploads.ts.
  const admin = (req: FastifyRequest, reply: FastifyReply) => {
    const token = parseSessionCookie(req.headers.cookie)
    const user = token ? getSessionUser(dbHolder.current, token, process.env.SESSION_SECRET ?? '') : null
    if (!user) { void reply.code(401).send({ error: 'UNAUTHORIZED' }); return null }
    if (user.role !== 'admin') { void reply.code(403).send({ error: 'FORBIDDEN' }); return null }
    return user
  }

  // Phase 1 → Phase 2 hand-off: `restoreId` → extracted `destDir` (short-lived,
  // in-memory). A restore consumes/removes its entry; leftovers are ephemeral.
  const restoreDirs = new Map<string, string>()
  // Backing expiry timers so an abandoned upload (validate passed, restore never
  // confirmed) cannot leak its temp dir + map entry forever.
  const restoreDirsTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Drop a pending restore so it can't leak: remove the map entry + its expiry
  // timer and wipe the temp base dir (the archive + extracted tree, which is
  // `dirname(dest)`). Idempotent — safe to call from success, failure, and the
  // expiry-path; errors are swallowed since it's best-effort cleanup.
  const dropRestore = (restoreId: string, dest?: string) => {
    restoreDirs.delete(restoreId)
    const timer = restoreDirsTimers.get(restoreId)
    if (timer) { clearTimeout(timer); restoreDirsTimers.delete(restoreId) }
    if (dest) void rm(dirname(dest), { recursive: true, force: true }).catch(() => {})
  }

  // One create at a time: a create is a multi-megabyte tar plus a full uploads
  // copy, and two at once only fight for the same disk. In-process, not a lock
  // file — one process owns this directory (ADR-0006), which is also what makes
  // the boot sweep below exact rather than a heuristic.
  let creating = false

  // Nothing can be mid-backup before this process starts, so any `running`
  // sidecar on disk belongs to a process that died. Best-effort: a failure here
  // must not stop the server from booting.
  void sweepRunningToFailed(dataDir).catch(() => {})

  // Download a stored backup. A plain GET so the browser can navigate to it and
  // let the `Content-Disposition` header do the naming.
  app.get('/backups/:id/download', async (req, reply) => {
    if (!admin(req, reply)) return
    const { id } = req.params as { id: string }
    if (!isBackupId(id)) return reply.code(404).send({ error: 'not found' })
    const meta = await readBackupMeta(dataDir, id)
    // The id is already well-formed, so a missing sidecar can only mean the row
    // never existed: that is a 404, matching `DELETE`. A row that DOES exist but
    // is not ready is a 409 instead, so "still running" never reads as "gone".
    if (!meta) return reply.code(404).send({ error: 'not found' })
    // Only a completed backup has an archive — 409, not 404: the row exists, so
    // the client should retry rather than conclude the backup is gone.
    if (meta.status !== 'completed') return reply.code(409).send({ error: 'backup not ready' })
    const archive = archivePath(dataDir, id)
    if (!existsSync(archive)) return reply.code(409).send({ error: 'archive missing' })
    // `createdAt` is an ISO string; the filename gets the timestamp the old
    // fixed name never carried. `createdAt` is UTC (`toISOString`), so the
    // trailing `Z` says so — without it a user in another timezone would read
    // the stamp as local time.
    const stamp = `${meta.createdAt.slice(0, 19).replace(/:/g, '-')}Z`
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

  // Phase 1 for a STORED backup: validate the archive already on disk. Same
  // contract as `POST /upload/backup` — returns a preview and a restoreId, and
  // applies nothing — so the confirm step and the preview card are shared.
  app.post('/backups/:id/restore', async (req, reply) => {
    if (!admin(req, reply)) return
    const { id } = req.params as { id: string }
    if (!isBackupId(id)) return reply.code(404).send({ error: 'not found' })
    const meta = await readBackupMeta(dataDir, id)
    // Same three cases as `download`: the id is well-formed, so a missing sidecar
    // means the row never existed (404), while a row that exists but is not
    // completed is a 409 so "still running" never reads as "gone".
    if (!meta) return reply.code(404).send({ error: 'not found' })
    if (meta.status !== 'completed') return reply.code(409).send({ error: 'backup not ready' })
    const archive = archivePath(dataDir, id)
    if (!existsSync(archive)) return reply.code(409).send({ error: 'archive missing' })

    // The archive stays where it is — only the extraction is temporary, so a
    // failed validation never endangers the stored backup.
    const tmp = await mkdtemp(join(tmpdir(), 'homebox-restore-'))
    const dest = join(tmp, 'extract')
    try {
      const { preview, restoreId } = await validateBackup(archive, dest)
      // Keep the validated extraction for the confirm step, and arm an expiry
      // timer so a never-confirmed restore can't leak the temp dir forever.
      restoreDirs.set(restoreId, dest)
      const timer = setTimeout(() => dropRestore(restoreId, dest), RESTORE_TTL_MS)
      timer.unref()
      restoreDirsTimers.set(restoreId, timer)
      return { preview, restoreId }
    } catch {
      // An unreadable stored archive (bad gzip, missing dump, failed integrity
      // check) is a client error, not a server fault. Return 400 and leave the
      // live DB untouched — validateBackup applies nothing. Clean up the temp dir
      // so it can't leak; the stored archive itself is untouched.
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
      return reply.code(400).send({ error: 'invalid backup archive' })
    }
  })

  // Declared BEFORE the route that references it: a `const` arrow is in the
  // temporal dead zone until its line runs, and a ReferenceError thrown from the
  // handler would fire after `creating = true`, deadlocking every future create.
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

  // List stored backups, newest first.
  app.get('/backups', async (req, reply) => {
    if (!admin(req, reply)) return
    return { backups: await listBackups(dataDir) }
  })

  // Phase 1 — ingest + validate (non-destructive).
  app.post('/upload/backup', async (req, reply) => {
    if (!admin(req, reply)) return
    // No size cap here: the global multipart limit is the photo ceiling, and a
    // backup carries every photo, so it routinely outgrows it. Streamed to disk
    // rather than buffered, for the same reason.
    const part = await req.file({ limits: { fileSize: Infinity } })
    if (!part) return reply.code(400).send({ error: 'expected a backup archive' })
    const tmp = await mkdtemp(join(tmpdir(), 'homebox-restore-'))
    const archive = join(tmp, 'backup.tar.gz')
    const dest = join(tmp, 'extract')
    try {
      await pipeline(part.file, createWriteStream(archive))
      const { preview, restoreId } = await validateBackup(archive, dest)
      // Keep the validated extraction for the confirm step, and arm an expiry
      // timer so a never-confirmed restore can't leak the temp dir forever.
      restoreDirs.set(restoreId, dest)
      const timer = setTimeout(() => dropRestore(restoreId, dest), RESTORE_TTL_MS)
      timer.unref()
      restoreDirsTimers.set(restoreId, timer)
      return { preview, restoreId }
    } catch {
      // An undecodable archive (bad gzip, missing dump, failed integrity check,
      // or an unsafe/traversal member caught by the guard) is a client error,
      // not a server fault. Return 400 and leave the live DB untouched —
      // validateBackup applies nothing. Clean up the temp dir so it can't leak.
      await rm(tmp, { recursive: true, force: true }).catch(() => {})
      return reply.code(400).send({ error: 'invalid backup archive' })
    }
  })

  // Phase 2 — confirm (destructive).
  app.post('/backup/restore', async (req, reply) => {
    if (!admin(req, reply)) return
    const { restoreId } = (req.body ?? {}) as { restoreId?: string }
    const dest = restoreId ? restoreDirs.get(restoreId) : undefined
    if (!dest || !restoreId) return reply.code(400).send({ error: 'unknown restoreId' })
    // A thumbnail run writes into the `uploads/` tree a restore is about to
    // replace. Refused before anything is consumed, so the confirm can be retried
    // once the run finishes.
    if (maintenance.thumbnails.status === 'running') return reply.code(409).send({ error: 'thumbnails_in_progress' })
    maintenance.restoring = true
    try {
      await applyRestore(dbHolder, dest, dbPath, dataDir)
      return { ok: true }
    } finally {
      maintenance.restoring = false
      // Whether the swap succeeded or failed, the validated extraction has been
      // consumed (or can no longer be safely applied) — drop the map entry + its
      // temp dir so it can't leak. Idempotent and best-effort.
      dropRestore(restoreId, dest)
    }
  })
}
