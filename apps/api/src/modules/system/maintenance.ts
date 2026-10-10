import { TRPCError } from '@trpc/server'
import type { DrizzleDb } from '@homebox/db'
import { regenerateThumbnails, type SkippedThumbnail } from '../images/regenerate.js'

// The result list is for reading, not for an audit: past this many the summary
// keeps counting but stops listing.
export const SKIPPED_LIST_MAX = 50

export type ThumbnailJob =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number }
  | { status: 'done'; total: number; rewritten: number; resized: number; skippedCount: number; skipped: SkippedThumbnail[] }
  | { status: 'failed'; error: string }

/**
 * Long-running admin work that must not overlap: a thumbnail run writes into
 * `uploads/`, and a restore replaces `uploads/` and the database wholesale. One
 * object per app, shared by the tRPC context and the backup routes.
 *
 * In memory on purpose. One process owns the data (ADR-0006), so these flags are
 * exact rather than heuristic, and a restart losing a thumbnail run's progress or
 * result costs nothing: the run is safe to repeat.
 */
export type Maintenance = { restoring: boolean; thumbnails: ThumbnailJob }

export const createMaintenance = (): Maintenance => ({ restoring: false, thumbnails: { status: 'idle' } })

// Start a thumbnail run in the background and return its state. A run already in
// progress is returned rather than doubled, so a second admin (or a second tab)
// joins it.
export const startThumbnailJob = (m: Maintenance, db: DrizzleDb, dataDir: string): ThumbnailJob => {
  if (m.thumbnails.status === 'running') return m.thumbnails
  if (m.restoring) throw new TRPCError({ code: 'CONFLICT', message: 'A restore is in progress.' })
  const job: Extract<ThumbnailJob, { status: 'running' }> = { status: 'running', done: 0, total: 0 }
  m.thumbnails = job
  // shortcut: in-process promise, not a durable queue — a restart drops the run,
  // which only means clicking again (ADR-0006).
  void regenerateThumbnails(db, dataDir, (done, total) => {
    job.done = done
    job.total = total
  })
    .then(({ skipped, ...counts }) => {
      m.thumbnails = { status: 'done', ...counts, skippedCount: skipped.length, skipped: skipped.slice(0, SKIPPED_LIST_MAX) }
    })
    .catch((err: unknown) => {
      m.thumbnails = { status: 'failed', error: (err as Error)?.message ?? String(err) }
    })
  return job
}
