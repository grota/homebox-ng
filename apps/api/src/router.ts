import { t, publicProcedure } from './trpc.js'
import { authRouter } from './modules/auth/router.js'
import { usersRouter } from './modules/users/router.js'

export { publicProcedure }

export const appRouter = t.router({
  ping: publicProcedure.query(() => 'pong'),
  auth: authRouter,
  users: usersRouter,
})
export type AppRouter = typeof appRouter
