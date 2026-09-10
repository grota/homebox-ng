import Fastify from 'fastify'
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify'
import type { DrizzleDb } from '@homebox/db'
import { appRouter, type AppRouter } from './router.js'
import { createContext, type DbHolder } from './context.js'
import { registerUploadRoutes } from './uploads.js'
import { registerBackupRoutes } from './modules/backup/backupRoutes.js'
import { registerUnpackRoute } from './modules/unpack/route.js'
import { getSettings } from './modules/instanceSettings/service.js'
import { registerDetectionProviders } from './modules/detection/register.js'

export type BuildAppOptions = { db: DrizzleDb; dataDir?: string; dbPath?: string }

// Build a Fastify instance with `/health`, tRPC mounted under `/trpc`, and the
// image upload/file routes. Exported for tests and for embedding (e.g. a server
// entrypoint or another Fastify host). Doesn't read env — callers pass the db
// (and optionally `dataDir`) in.
export const buildApp = ({ db, dataDir = './data', dbPath }: BuildAppOptions) => {
  const app = Fastify()
  // The live DB is held behind a holder so a restore can swap it in place. Both
  // tRPC and the upload/backup routes read `dbHolder.current` per request, so
  // they keep working after a restore (instead of holding a closed old handle).
  const dbHolder: DbHolder = { current: db }

  app.get('/health', async () => ({ ok: true }))

  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: createContext(dbHolder, dataDir),
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  })

  // Uploads first: it registers @fastify/multipart, which the backup upload route
  // reuses (`/upload/backup` reads `req.file()`).
  registerUploadRoutes(app, { dbHolder, dataDir })
  registerBackupRoutes(app, { dbHolder, dataDir, dbPath })
  // After the upload/backup routes so `@fastify/multipart` (registered by
  // registerUploadRoutes) is available to the unpack route's `req.file()`.
  registerUnpackRoute(app, { dbHolder, dataDir })

  // Register the detection providers against live instance settings. The mock
  // gate (DETECTION_MOCK=1) lets e2e/smoke runs avoid real model/API calls.
  registerDetectionProviders(() => getSettings(dbHolder.current), { mock: process.env.DETECTION_MOCK === '1' })

  return app
}

export * from './router.js'
export * from './context.js'
