import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Fail at boot, naming the fix, when this process cannot write its own data.
//
// The failure this prevents is specific and is the one this project is
// deployed next to: the install being replaced runs as root, so its `data/` is
// root-owned. Bind that directory into a container running as uid 1000 and the
// first symptom is `SQLITE_CANTOPEN` on startup, or an `EACCES` partway through
// a model download — neither of which mentions ownership, and neither of which
// appears until the app is already running. The same happens to anyone who once
// ran the dev server under `sudo`, which is why this lives in the app and not in
// a container entrypoint.
//
// `mkdirSync` is deliberate about `recursive` so a fresh checkout with no `data/`
// still boots (the E2E's `DATABASE_PATH=./data/e2e.db` relies on it), but mkdir
// is satisfied by a directory that already exists and belongs to someone else, so
// it cannot be the check. Creating a file can.
const probeDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true })
  const probe = join(dir, `.write-probe-${process.pid}`)
  try {
    writeFileSync(probe, '')
  } finally {
    // Best-effort: if the write threw, the file does not exist to remove.
    try {
      unlinkSync(probe)
    } catch {
      /* nothing was created */
    }
  }
}

/**
 * Throws unless both the data directory and the database's directory can be
 * written by this process. Called once at startup, before the database is opened
 * and before any route can fail for a reason that hides this one.
 */
export const assertWritableDataDir = (dataDir: string, dbPath: string): void => {
  for (const dir of new Set([dataDir, dirname(dbPath)])) {
    try {
      probeDir(dir)
    } catch (err) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : 'unknown'
      throw new Error(
        `Cannot write to ${dir} as uid ${uid}: ${(err as Error).message}. ` +
          `If this is a bind mount, the host directory must be owned by uid ${uid} — ` +
          `\`sudo chown -R ${uid}:${uid} <host directory>\` — then start again.`,
      )
    }
  }
}
