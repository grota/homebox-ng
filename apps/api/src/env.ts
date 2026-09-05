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
