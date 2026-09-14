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
