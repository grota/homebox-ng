import { initTRPC } from '@trpc/server'
import type { Context } from './context.js'

// Single `initTRPC` instance for the whole app. Extracted (rather than defined
// in `router.ts`) so both the top-level router and the auth sub-router can
// import the same `t`/`publicProcedure` without a circular import.
export const t = initTRPC.context<Context>().create()
export const publicProcedure = t.procedure
