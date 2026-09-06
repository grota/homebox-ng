import type { FastifyRequest, FastifyReply } from 'fastify'
import type { DrizzleDb } from '@homebox/db'
import { getSessionUser } from './auth/sessions.js'

export type SessionUser = { id: number; role: 'admin' | 'user' }
export type Context = { db: DrizzleDb; user: SessionUser | null; req: FastifyRequest; res: FastifyReply }
// Holds the live (swappable) DB. Restore swaps `holder.current` for a fresh
// connection, so per-request consumers (tRPC context, upload routes) must read
// the handle at request time rather than capture the original instance.
export type DbHolder = { current: DrizzleDb }

// Pulls the raw `session=<token>` value out of a Cookie/Set-Cookie header. The
// header may carry extra attributes (`; HttpOnly; SameSite=Lax; Path=/`), so we
// scan the `;`-separated parts and return the token for the `session` key.
export const parseSessionCookie = (cookieHeader: string | undefined): string | null => {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === 'session') return rest.join('=')
  }
  return null
}

// A context factory bound to a DB holder. Called by the tRPC Fastify adapter for
// every request with `{ req, res }`. Resolves the current user from the `session`
// cookie (signed by SESSION_SECRET); unauthenticated requests get `user: null`.
// The live DB is read from `holder.current` at call time so a restore that swaps
// the connection takes effect on the next request.
export const createContext = (holder: DbHolder) => async ({ req, res }: { req: FastifyRequest; res: FastifyReply }): Promise<Context> => {
  const db = holder.current
  const token = parseSessionCookie(req.headers.cookie)
  const user = token ? getSessionUser(db, token, process.env.SESSION_SECRET ?? '') : null
  return { db, user, req, res }
}
