import { sql } from 'drizzle-orm'
import { items } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import { rebuildFTS } from '../items/fts.js'

export const rebuild = (db: DrizzleDb): { reindexed: number } => {
  // `select().from().get()` is the proven count pattern (see repo.ts); avoid the
  // top-level `db.all(sql)` form.
  const row = db.select({ n: sql<number>`count(*)` }).from(items).get()
  rebuildFTS(db)
  return { reindexed: Number(row?.n ?? 0) }
}
