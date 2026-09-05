import { t, publicProcedure } from './trpc.js'
import { authRouter } from './modules/auth/router.js'

export { publicProcedure }

export const appRouter = t.router({
  ping: publicProcedure.query(() => 'pong'),
  auth: authRouter,
})
export type AppRouter = typeof appRouter
