import Fastify from 'fastify'
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify'
import type { DrizzleDb } from '@homebox/db'
import { appRouter, type AppRouter } from './router.js'
import { createContext, type DbHolder } from './context.js'
import { registerUploadRoutes } from './uploads.js'
import { registerBackupRoutes } from './modules/backup/backupRoutes.js'
import { registerUnpackRoute } from './modules/unpack/route.js'
import { getSettings } from './modules/instanceSettings/service.js'
import { DEFAULT_DATA_DIR, type LogLevel } from './env.js'
import { registerDetectionProviders } from './modules/detection/register.js'

export type BuildAppOptions = {
  db: DrizzleDb
  dataDir?: string
  dbPath?: string
  /** Reported by `/health`. The release image bakes the git tag in as `APP_VERSION`. */
  version?: string
  /**
   * pino level for Fastify's logger. Omitting it means no logger at all, which is
   * what the tests want — `buildApp` never reads env, and defaulting to `info`
   * here would bury a failing assertion under a request line per HTTP call.
   * `index.ts` is the only caller that passes one, from `LOG_LEVEL`.
   */
  logLevel?: LogLevel
}

// Build a Fastify instance with `/health`, tRPC mounted under `/trpc`, and the
// image upload/file routes. Exported for tests and for embedding (e.g. a server
// entrypoint or another Fastify host). Doesn't read env — callers pass the db
// (and optionally `dataDir`) in; the fallback is the workspace-root default from
// `env.ts`, so an omitted `dataDir` doesn't follow the process cwd.
export const buildApp = ({
  db,
  dataDir = DEFAULT_DATA_DIR,
  dbPath,
  version = process.env.APP_VERSION ?? 'dev',
  logLevel,
}: BuildAppOptions) => {
  // `false` rather than no argument, because that is the same thing and the
  // explicit form is what says the silence is deliberate.
  const app = Fastify({ logger: logLevel === undefined ? false : { level: logLevel } })
  // The live DB is held behind a holder so a restore can swap it in place. Both
  // tRPC and the upload/backup routes read `dbHolder.current` per request, so
  // they keep working after a restore (instead of holding a closed old handle).
  const dbHolder: DbHolder = { current: db }

  // `version` is the whole point of the release pipeline's build argument: a
  // self-hosted instance should be able to say which build it is running without
  // anyone reading image labels off the host.
  app.get('/health', async () => ({ ok: true, version }))

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
  registerDetectionProviders(() => getSettings(dbHolder.current), {
    mock: process.env.DETECTION_MOCK === '1',
    dataDir,
  })

  return app
}

export * from './router.js'
export * from './context.js'
