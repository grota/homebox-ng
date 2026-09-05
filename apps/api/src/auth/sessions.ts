import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { users, sessions } from '@homebox/db'
import type { DrizzleDb } from '@homebox/db'
import type { SessionUser } from '../context'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// Sessions store `token_hash = sha256(token + secret)`. All three session
// functions are synchronous: the drizzle better-sqlite3 driver's `.run()` /
// `.get()` are sync, so callers invoke them without `await`.
export const createSession = (db: DrizzleDb, userId: number, secret: string) => {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  db.insert(sessions).values({ userId, tokenHash: sha(token + secret), expiresAt, createdAt: new Date() }).run()
  return { token, expiresAt }
}

export const getSessionUser = (db: DrizzleDb, token: string, secret: string): SessionUser | null => {
  const s = db.select().from(sessions).where(eq(sessions.tokenHash, sha(token + secret))).get()
  if (!s) return null
  if (s.expiresAt === null) return null
  if (s.expiresAt < new Date()) return null
  return db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, s.userId)).get() ?? null
}

export const invalidateSession = (db: DrizzleDb, token: string, secret: string) => {
  db.delete(sessions).where(eq(sessions.tokenHash, sha(token + secret))).run()
}
