import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createDb, images } from '@homebox/db'
import { DEFAULT_DATA_DIR, DEFAULT_DATABASE_PATH, resolveDataPath } from '../src/env.js'
import { renderThumbnail } from '../src/modules/images/thumbnail.js'

// Admin CLI: re-render every stored thumbnail from its original, using the rule in
// `modules/images/thumbnail.ts`.
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
// and already in the database, so no row changes, no file is orphaned, and a second
// run produces the same bytes as the first.
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
  const rows = db
    .select({ originalPath: images.originalPath, thumbPath: images.thumbPath, edit: images.editedPath })
    .from(images)
    .all()

  process.stdout.write(`Re-rendering ${rows.length} thumbnail(s) from ${dataDir}\n`)

  let written = 0
  const failed: string[] = []
  for (const row of rows) {
    try {
      // The displayed photo — the edit when there is one, else the original — which
      // is what the edit route renders the thumb from (see the image-editor spec).
      // Rendering an edited photo's thumb from its original would undo the edit on
      // every card.
      const source = await readFile(join(dataDir, row.edit ?? row.originalPath))
      const thumb = await renderThumbnail(source)
      const dest = join(dataDir, row.thumbPath)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, thumb)
      written++
    } catch (err) {
      // One unreadable original must not abandon the remaining hundreds, so the
      // loop carries on and the summary at the end is the report.
      failed.push(`${row.edit ?? row.originalPath}: ${(err as Error).message}`)
    }
  }

  for (const line of failed) process.stderr.write(`skipped — ${line}\n`)
  process.stdout.write(`\n${written} rewritten, ${failed.length} skipped, of ${rows.length} images.\n`)
  process.exit(failed.length > 0 ? 1 : 0)
}

void main()
