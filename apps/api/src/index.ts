import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fastifyStatic from '@fastify/static'
import { createDb, runMigrations } from '@homebox/db'
import { loadEnv } from './env.js'
import { buildApp } from './server.js'

// Resolve the built SPA regardless of whether we run from `src/` (tsx) or
// `dist/` (compiled `start`). `apps/api/{src|dist}/index.{ts,js}` two levels up
// lands in `apps/`, then `/web/dist`.
const webDist = join(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')

const env = loadEnv()

// better-sqlite3 refuses to create the database's parent directory; make it so
// a fresh checkout with a missing `data/` dir still boots (e.g. the E2E's
// `DATABASE_PATH=./data/e2e.db`).
mkdirSync(dirname(env.DATABASE_PATH), { recursive: true })

const db = createDb(env.DATABASE_PATH)
runMigrations(db)

const app = buildApp({ db, dataDir: env.DATA_DIR, dbPath: env.DATABASE_PATH })

// Serve the built SPA. `@fastify/static` registers a `GET /*` wildcard, but
// find-my-way prioritises the more-specific `/trpc/:path`, `/upload/image`, and
// `/file/*` routes already registered by `buildApp`, so none are shadowed.
await app.register(fastifyStatic, { root: webDist, prefix: '/' })

// SPA fallback: any non-asset GET that isn't an API route serves `index.html`
// so client-side routes (`/`, `/setup`, `/login`, `/items/:id`, …) reload
// cleanly. Real asset paths (`.js`/`.css`/`.jpg`) are served by @fastify/static
// when present; a missing asset 404s instead of getting HTML.
const isAsset = (pathname: string) => /\.[a-z0-9]+$/i.test(pathname)
app.setNotFoundHandler(async (req, reply) => {
  if ((req.method === 'GET' || req.method === 'HEAD') && !isAsset(req.url.split('?')[0])) {
    return reply.sendFile('index.html')
  }
  return reply.code(404).send({ error: 'Not found' })
})

await app.listen({ port: env.PORT, host: '0.0.0.0' })
