import Database from 'better-sqlite3'
import type { Statement } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

// The drizzle better-sqlite3 wrapper does not surface the raw driver's
// `prepare` (only `$client.prepare`), but the brief's migrate test and several
// downstream raw-SQL helpers call `db.prepare(...)`. We re-expose it on the
// instance while still returning the full drizzle object that `runMigrations`
// and the query builder require.
export type DrizzleDb = BetterSQLite3Database<typeof schema> & {
  prepare: (source: string) => Statement
}

export const createDb = (dbPath: string): DrizzleDb => {
  const sqlite = new Database(dbPath)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema }) as unknown as DrizzleDb
  db.prepare = sqlite.prepare.bind(sqlite)
  return db
}
