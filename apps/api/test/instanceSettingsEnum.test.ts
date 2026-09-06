import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDb, runMigrations } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { DEFAULT_INSTANCE_SETTINGS } from '@homebox/shared'
import { getOrCreate } from '../src/modules/instanceSettings/repo'

// The committed 0004 migration, resolved relative to this file so the test stays
// tied to the real migration on disk (not a hand-copied duplicate).
const MIGRATION_0004 = fileURLToPath(
  new URL('../../../packages/db/drizzle/0004_bouncy_midnight.sql', import.meta.url)
)

// The drizzle wrapper does not surface the raw driver's `exec` on `DrizzleDb`'s
// declared type, so re-expose it (runtime `$client` is always present).
const execSql = (db: DrizzleDb, sql: string) => {
  ;(db as unknown as { $client: { exec: (sql: string) => unknown } }).$client.exec(sql)
}

// Reconstruct the pre-0004 (migration 0003) `instance_settings` column set:
// `detection_provider` defaults to 'remote', so a stored 'remote' row can be
// migrated by 0004.
const createPreMigrationInstanceSettings = (db: DrizzleDb) => {
  execSql(db, `
    CREATE TABLE instance_settings (
      id integer PRIMARY KEY NOT NULL,
      max_upload_mb integer DEFAULT 10 NOT NULL,
      detection_provider text DEFAULT 'remote' NOT NULL,
      detection_config text
    )
  `)
}

// Execute the committed 0004 migration verbatim (table-rebuild + data-fix).
const applyMigration0004 = (db: DrizzleDb) => {
  const sql = readFileSync(MIGRATION_0004, 'utf8')
  for (const chunk of sql.split('--> statement-breakpoint')) {
    const stmt = chunk.trim()
    if (stmt) execSql(db, stmt)
  }
}

describe('detection_provider enum widening', () => {
  it('defaults to google and accepts the new providers', () => {
    expect(DEFAULT_INSTANCE_SETTINGS.detectionProvider).toBe('google')
    const db = createDb(':memory:')
    runMigrations(db)
    const s = getOrCreate(db)
    expect(s.detectionProvider).toBe('google')
  })
  it('migration remaps a stored remote row to google', () => {
    const db = createDb(':memory:')
    // Pre-0004 state: build the 0003 table with a stored 'remote' row BEFORE the
    // migration runs, so the data-fix UPDATE actually matches a row.
    createPreMigrationInstanceSettings(db)
    execSql(db, "INSERT INTO instance_settings (id, max_upload_mb, detection_provider) VALUES (1, 10, 'remote')")
    // Apply the committed 0004 migration (CREATE __new → INSERT…SELECT → DROP →
    // RENAME → UPDATE … WHERE detection_provider='remote').
    applyMigration0004(db)
    const row = db.prepare('SELECT detection_provider AS p FROM instance_settings WHERE id = 1').get() as { p: string }
    expect(row.p).toBe('google')
  })
})
