import { t, publicProcedure } from './trpc.js'
import { authRouter } from './modules/auth/router.js'
import { usersRouter } from './modules/users/router.js'
import { locationsRouter } from './modules/locations/router.js'

export { publicProcedure }

export const appRouter = t.router({
  ping: publicProcedure.query(() => 'pong'),
  auth: authRouter,
  users: usersRouter,
  locations: locationsRouter,
})
export type AppRouter = typeof appRouter
