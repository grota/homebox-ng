import { describe, it, expect, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertWritableDataDir } from '../src/dataDir'

const made: string[] = []
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'hbng-data-'))
  made.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of made.splice(0)) {
    // A directory the test made unwritable has to be restorable before removal.
    try { chmodSync(dir, 0o700) } catch { /* already gone */ }
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('assertWritableDataDir', () => {
  it('creates the directories when they are missing, and leaves no probe behind', () => {
    const root = tempDir()
    const dataDir = join(root, 'data')
    const dbPath = join(dataDir, 'nested', 'homebox.db')

    expect(() => assertWritableDataDir(dataDir, dbPath)).not.toThrow()
    expect(existsSync(join(dataDir, 'nested'))).toBe(true)
    // The probe is how writability is asked; it must not survive the question.
    expect(readdirSync(dataDir).filter((f) => f.startsWith('.write-probe'))).toEqual([])
  })

  it('passes when the database shares the data directory', () => {
    const dataDir = tempDir()
    expect(() => assertWritableDataDir(dataDir, join(dataDir, 'homebox.db'))).not.toThrow()
  })

  // The failure this exists for: a bind-mounted `data/` owned by another user.
  // Root ignores the mode bits, so the assertion is meaningless there — and
  // running the suite as root is normal in some CI images.
  it.skipIf(process.getuid?.() === 0)('names the uid and the chown when the directory is not writable', () => {
    const root = tempDir()
    const dataDir = join(root, 'data')
    mkdirSync(dataDir)
    chmodSync(dataDir, 0o555)

    expect(() => assertWritableDataDir(dataDir, join(dataDir, 'homebox.db')))
      .toThrow(new RegExp(`Cannot write to ${dataDir} as uid ${process.getuid!()}.*chown -R ${process.getuid!()}`))
  })

  // Independent of permissions, so it also covers a root run: a *file* where the
  // directory should be cannot be created into, whatever the uid.
  it('throws when the path is a file rather than a directory', () => {
    const root = tempDir()
    const asFile = join(root, 'data')
    writeFileSync(asFile, '')

    expect(() => assertWritableDataDir(asFile, join(asFile, 'homebox.db'))).toThrow(/Cannot write to/)
  })
})
