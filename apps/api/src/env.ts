import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Load the repo-root `.env` (path is the same from `src/` and `dist/` — both are
// one level under `apps/api`, so three `..` land on the workspace root) so the
// API honors `.env` when started with `pnpm --filter @homebox/api start`, without
// requiring the vars to be exported in the shell.
//
// - Existing environment variables take precedence (the e2e webServer sets its
//   own `DATABASE_PATH`/`SESSION_SECRET`/… explicitly, and those must win).
// - A missing `.env` is a no-op (fresh checkouts, CI).
export function loadDotEnv(): void {
  const envFile = fileURLToPath(new URL('../../../.env', import.meta.url))
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

export type Env = {
  PORT: number
  DATABASE_PATH: string
  DATA_DIR: string
  SESSION_SECRET: string
}

// Only SESSION_SECRET is truly required (it guards session cookies in a later
// phase). The rest fall back to the values in `.env.example`.
const REQUIRED = ['SESSION_SECRET'] as const
const DEFAULTS = {
  PORT: '3000',
  DATABASE_PATH: './data/homebox.db',
  DATA_DIR: './data',
} as const

// Lazily read env so importing this module has no side effects — `buildApp`
// never calls `loadEnv`, so tests (which build the app with an explicit in-memory
// db) are not forced to provide a `SESSION_SECRET`.
export const loadEnv = (env: NodeJS.ProcessEnv = process.env): Env => {
  // Fill gaps in `process.env` from the repo-root `.env` before validating, so a
  // plain `pnpm --filter @homebox/api start` honors `.env`. Callers that pass an
  // explicit `env` (tests, the e2e webServer) still win — `loadDotEnv` only sets
  // keys that are `undefined` in `process.env`, and the returned `Env` is built
  // from the passed `env`.
  loadDotEnv()
  const missing = REQUIRED.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. Add them to your .env (see .env.example).`,
    )
  }
  return {
    PORT: Number(env.PORT ?? DEFAULTS.PORT),
    DATABASE_PATH: env.DATABASE_PATH ?? DEFAULTS.DATABASE_PATH,
    DATA_DIR: env.DATA_DIR ?? DEFAULTS.DATA_DIR,
    SESSION_SECRET: env.SESSION_SECRET as string,
  }
}
