import type { FastifyRequest } from 'fastify'
import type { DrizzleDb } from '@homebox/db'

export type SessionUser = { id: number; role: 'admin' | 'user' }
export type Context = { db: DrizzleDb; user: SessionUser | null }

// A context factory bound to a specific DB instance. Called by the tRPC
// Fastify adapter for every request with `{ req, res }`. Session resolution is
// wired up in a later phase (Task 5); for now the user is always null.
export const createContext = (db: DrizzleDb) => async ({ req }: { req: FastifyRequest }): Promise<Context> => {
  return { db, user: null }
}
