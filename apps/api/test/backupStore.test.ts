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
