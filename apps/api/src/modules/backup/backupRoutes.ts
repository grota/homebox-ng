import { createReadStream } from 'node:fs'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { parseSessionCookie } from '../../context.js'
import type { DbHolder } from '../../context.js'
import { getSessionUser } from '../../auth/sessions.js'
import { createBackup, validateBackup, applyRestore } from './service.js'

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

  // Download a fresh backup archive.
  app.get('/backup', async (req, reply) => {
    if (!admin(req, reply)) return
    const { archivePath } = await createBackup(dbHolder.current, dataDir)
    reply.header('Content-Type', 'application/gzip')
    reply.header('Content-Disposition', 'attachment; filename="homebox-backup.tar.gz"')
    const stream = createReadStream(archivePath)
    stream.on('close', () => void rm(archivePath, { recursive: true, force: true }))
    return reply.send(stream)
  })

  // Phase 1 — ingest + validate (non-destructive).
  app.post('/upload/backup', async (req, reply) => {
    if (!admin(req, reply)) return
    const part = await req.file()
    if (!part) return reply.code(400).send({ error: 'expected a backup archive' })
    const tmp = await mkdtemp(join(tmpdir(), 'homebox-restore-'))
    const archive = join(tmp, 'backup.tar.gz')
    await writeFile(archive, await part.toBuffer())
    const dest = join(tmp, 'extract')
    try {
      const { preview, restoreId } = await validateBackup(archive, dest)
      restoreDirs.set(restoreId, dest)
      return { preview, restoreId }
    } catch {
      // An undecodable archive (bad gzip, missing dump, failed integrity check)
      // is a client error, not a server fault. Return 400 and leave the live
      // DB untouched — validateBackup applies nothing.
      return reply.code(400).send({ error: 'invalid backup archive' })
    }
  })

  // Phase 2 — confirm (destructive).
  app.post('/backup/restore', async (req, reply) => {
    if (!admin(req, reply)) return
    const { restoreId } = (req.body ?? {}) as { restoreId?: string }
    const dest = restoreId ? restoreDirs.get(restoreId) : undefined
    if (!dest || !restoreId) return reply.code(400).send({ error: 'unknown restoreId' })
    await applyRestore(dbHolder, dest, dbPath, dataDir)
    restoreDirs.delete(restoreId)
    return { ok: true }
  })
}
