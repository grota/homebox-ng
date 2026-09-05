import { initTRPC } from '@trpc/server'
import type { Context } from './context.js'

// tRPC v11 no longer tops-level-exports `router`/`publicProcedure`; they come
// from a single `initTRPC` instance initialized once per app. Type it with our
// `Context` so procedures see `{ db, user }`.
const t = initTRPC.context<Context>().create()

export const publicProcedure = t.procedure

export const appRouter = t.router({
  ping: publicProcedure.query(() => 'pong'),
})
export type AppRouter = typeof appRouter
