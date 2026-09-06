import { t, publicProcedure } from './trpc.js'
import { authRouter } from './modules/auth/router.js'
import { usersRouter } from './modules/users/router.js'
import { locationsRouter } from './modules/locations/router.js'
import { itemTypesRouter } from './modules/itemTypes/router.js'
import { itemsRouter } from './modules/items/router.js'
import { imagesRouter } from './modules/images/router.js'
import { tagsRouter } from './modules/tags/router.js'
import { settingsRouter } from './modules/settings/router.js'
import { instanceSettingsRouter } from './modules/instanceSettings/router.js'
import { systemRouter } from './modules/system/router.js'

export { publicProcedure }

export const appRouter = t.router({
  ping: publicProcedure.query(() => 'pong'),
  auth: authRouter,
  users: usersRouter,
  locations: locationsRouter,
  itemTypes: itemTypesRouter,
  items: itemsRouter,
  images: imagesRouter,
  tags: tagsRouter,
  settings: settingsRouter,
  instanceSettings: instanceSettingsRouter,
  system: systemRouter,
})
export type AppRouter = typeof appRouter
