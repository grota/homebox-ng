import { createReadStream } from 'node:fs'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseSessionCookie } from '../../context.js'
import type { DbHolder } from '../../context.js'
import { getSessionUser } from '../../auth/sessions.js'
import { createBackup, validateBackup, applyRestore } from './service.js'

// How long a validated-but-unconfirmed restore stays available before it is
// treated as abandoned and its temp dir is cleaned up.
const RESTORE_TTL_MS = 15 * 60 * 1000 // 15 minutes

export const registerBackupRoutes = (app: FastifyInstance, opts: { dbHolder: DbHolder; dataDir: string; dbPath?: string }): void => {
  const { dbHolder, dataDir, dbPath } = opts

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

  // Phase 1 — ingest + validate (non-destructive).
  app.post('/upload/backup', async (req, reply) => {
    if (!admin(req, reply)) return
    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'expected a backup archive' })
    const tmp = await mkdtemp(join(tmpdir(), 'homebox-restore-'))
    const archive = join(tmp, 'backup.tar.gz')
    const dest = join(tmp, 'extract')
    try {
      await writeFile(archive, await part.toBuffer())
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
    try {
      await applyRestore(dbHolder, dest, dbPath, dataDir)
      return { ok: true }
    } finally {
      // Whether the swap succeeded or failed, the validated extraction has been
      // consumed (or can no longer be safely applied) — drop the map entry + its
      // temp dir so it can't leak. Idempotent and best-effort.
      dropRestore(restoreId, dest)
    }
  })
}
