import Fastify from 'fastify'
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify'
import type { DrizzleDb } from '@homebox/db'
import { appRouter, type AppRouter } from './router.js'
import { createContext } from './context.js'
import { loadEnv } from './env.js'

export type BuildAppOptions = { db: DrizzleDb }

// Build a Fastify instance with `/health` and tRPC mounted under `/trpc`.
// Exported for tests and for embedding (e.g. a server entrypoint or another
// Fastify host). Doesn't read env — callers pass the db in.
export const buildApp = ({ db }: BuildAppOptions) => {
  const app = Fastify()

  app.get('/health', async () => ({ ok: true }))

  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: createContext(db),
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  })

  return app
}

// Alias matching the Interfaces note that names `createApp`.
export const createApp = buildApp

// Standalone start helper: reads env (throws if SESSION_SECRET is missing) and
// listens on the configured port.
export const listen = async (opts: { db: DrizzleDb; port?: number; host?: string }) => {
  const env = loadEnv()
  const app = buildApp({ db: opts.db })
  await app.listen({ port: opts.port ?? env.PORT, host: opts.host ?? '0.0.0.0' })
  return app
}

export * from './router.js'
export * from './context.js'
