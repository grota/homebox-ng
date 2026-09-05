import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { DrizzleDb } from './client.js'

// The migrations folder lives at `packages/db/drizzle/`. Resolve it relative to
// this module (works from `src/` under vitest and from `dist/` after build) via
// `import.meta.url` rather than `process.cwd()`, which may be the repo root.
const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

export const runMigrations = (db: DrizzleDb) => {
  return migrate(db, { migrationsFolder })
}
