import { initTRPC, TRPCError } from '@trpc/server'
import type { Context } from './context.js'

// Single `initTRPC` instance for the whole app. Extracted (rather than defined
// in `router.ts`) so both the top-level router and the auth sub-router can
// import the same `t`/`publicProcedure` without a circular import.
export const t = initTRPC.context<Context>().create()
export const publicProcedure = t.procedure

// Any authenticated user may pass. Rejects the request with `UNAUTHORIZED`
// when there is no user on the context.
export const protectedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' })
  return next()
})

// Admin-only. Rejects non-admins with `FORBIDDEN`. Later tasks reuse this
// layer for other admin-gated procedures.
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user?.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' })
  return next()
})
