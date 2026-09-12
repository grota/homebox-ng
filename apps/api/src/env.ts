import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Load the repo-root `.env` (path is the same from `src/` and `dist/` — both are
// one level under `apps/api`, so three `..` land on the workspace root) so the
// API honors `.env` when started with `pnpm --filter @homebox/api start`, without
// requiring the vars to be exported in the shell.
//
// - Existing environment variables take precedence (`process.loadEnvFile` never
//   overwrites an already-set var, so the e2e webServer's own
//   `DATABASE_PATH`/`SESSION_SECRET`/… win).
// - A missing `.env` is a no-op (fresh checkouts, CI).
export function loadDotEnv(): void {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)))
  } catch {
    // no `.env` on disk
  }
}

export type Env = {
  PORT: number
  DATABASE_PATH: string
  DATA_DIR: string
  SESSION_SECRET: string
}

// This module sits at `<root>/apps/api/{src,dist}`, so three `..` land on the
// workspace root — the same walk the `.env` lookup above makes.
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

// Every data path in `.env` (`DATA_DIR`, `DATABASE_PATH`) resolves against the
// workspace root, never the process cwd. `start` runs with `apps/api` as its cwd,
// so `DATA_DIR=./data` would otherwise mean `apps/api/data`: the same line in the
// same `.env` pointing at a different directory depending on who started the
// process. Absolute values are used as given.
export const resolveDataPath = (value: string): string =>
  isAbsolute(value) ? value : join(REPO_ROOT, value)

// Only SESSION_SECRET is truly required (it guards session cookies in a later
// phase). The rest fall back to the values in `.env.example`.
const REQUIRED = ['SESSION_SECRET'] as const
const DEFAULTS = {
  PORT: '3000',
  DATABASE_PATH: './data/homebox.db',
  DATA_DIR: './data',
} as const

// The data paths used when the corresponding var is unset — and the fallback for
// callers that never read env at all (`buildApp`, the `detection:model` and
// `seed` CLIs). Already resolved, so a caller can use them as given.
export const DEFAULT_DATA_DIR = resolveDataPath(DEFAULTS.DATA_DIR)
export const DEFAULT_DATABASE_PATH = resolveDataPath(DEFAULTS.DATABASE_PATH)

// Lazily read env so importing this module has no side effects — `buildApp`
// never calls `loadEnv`, so tests (which build the app with an explicit in-memory
// db) are not forced to provide a `SESSION_SECRET`.
export const loadEnv = (env: NodeJS.ProcessEnv = process.env): Env => {
  // Fill gaps in `process.env` from the repo-root `.env` before validating, so a
  // plain `pnpm --filter @homebox/api start` honors `.env`. Callers that pass an
  // explicit `env` (tests, the e2e webServer) still win — `loadDotEnv` never
  // overwrites an already-set var, and the returned `Env` is built from the
  // passed `env`.
  loadDotEnv()
  const missing = REQUIRED.filter((key) => !env[key])
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s): ${missing.join(', ')}. Add them to your .env (see .env.example).`,
    )
  }
  return {
    PORT: Number(env.PORT ?? DEFAULTS.PORT),
    // Both absolute by the time they leave here, so every consumer (index.ts's
    // `mkdirSync`/`createDb`, the upload and backup routes) can join onto them
    // without caring where the process was started from.
    DATABASE_PATH: resolveDataPath(env.DATABASE_PATH ?? DEFAULTS.DATABASE_PATH),
    DATA_DIR: resolveDataPath(env.DATA_DIR ?? DEFAULTS.DATA_DIR),
    SESSION_SECRET: env.SESSION_SECRET as string,
  }
}
