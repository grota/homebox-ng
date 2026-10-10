import { createDb } from '@homebox/db'
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE_PATH, resolveDataPath } from '../src/env.js'
import { regenerateThumbnails } from '../src/modules/images/regenerate.js'

// Admin CLI: re-render every stored thumbnail, using the rule in
// `modules/images/thumbnail.ts`. The work is `regenerateThumbnails`, which the
// admin System tab also runs (as a background job) for instances with no shell.
//
// **This is not needed to change how thumbnails look.** The display fix in
// `docs/superpowers/specs/2026-09-18-photo-fitting-and-page-width-design.md` fits the
// photo inside the box with `object-contain`, so it works on whatever shape the file
// already is. Nothing on disk has to move for it.
//
// It exists for the two cases where the *files* are wrong rather than the display:
//
//   1. Thumbnails rendered by an older rule. Four in the development data were
//      upscaled — larger than their sources in both axes — because the old rule
//      constrained only the width and `sharp` enlarges by default.
//   2. Any future change to the rule, which is otherwise only ever applied to
//      photos uploaded after it.
//
// It overwrites `thumbPath` **in place**. The path is already known, already unique
// and already in the database, so no path changes, no file is orphaned, and a second
// run produces the same bytes as the first. The only column it may write is the
// stored width/height, corrected to the displayed size.
//
// **Deleting `uploads/thumbs/` is not an alternative.** Thumbnails are written at
// upload/edit/unpack and never lazily, so removing them 404s every photo until each
// one is uploaded again. This script is what makes that not matter.
//
// Reads DATA_DIR and DATABASE_PATH straight from the environment rather than through
// `loadEnv`, which would demand a SESSION_SECRET the script has no use for — the same
// reason `detection-model.ts` does. Relative paths resolve against the workspace root
// exactly as the server resolves them.
//
// Usage:  pnpm --filter @homebox/api thumbnails:regenerate
const dataDir = resolveDataPath(process.env.DATA_DIR ?? DEFAULT_DATA_DIR)
const dbPath = resolveDataPath(process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH)

const main = async () => {
  // Deliberately no `runMigrations`: this is a maintenance pass over rows the app
  // itself created, and silently migrating a database is a side effect a thumbnail
  // tool should not own. A missing table fails immediately and says so.
  const db = createDb(dbPath)
  process.stdout.write(`Re-rendering thumbnails from ${dataDir}\n`)
  const { total, rewritten, resized, skipped } = await regenerateThumbnails(db, dataDir)

  for (const { path, reason } of skipped) process.stderr.write(`skipped — ${path}: ${reason}\n`)
  process.stdout.write(`\n${rewritten} rewritten, ${skipped.length} skipped, of ${total} images.\n`)
  if (resized > 0) process.stdout.write(`${resized} stored size(s) corrected.\n`)
  process.exit(skipped.length > 0 ? 1 : 0)
}

void main()
