import { describe, it, expect } from 'vitest'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DATA_DIR, loadEnv, resolveDataPath } from '../src/env'

// The workspace root as *this test file* sees it: `apps/api/test/env.test.ts` →
// three levels up.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

describe('env data paths', () => {
  // `pnpm --filter @homebox/api start` runs with `apps/api` as its cwd, so these
  // used to land at `apps/api/data`. They are resolved against the workspace root
  // now — derived from the module's own location, so where the process was
  // started is irrelevant.
  it('resolves the default data paths against the workspace root, not the cwd', () => {
    expect(isAbsolute(DEFAULT_DATA_DIR)).toBe(true)
    expect(DEFAULT_DATA_DIR).toBe(join(repoRoot, 'data'))

    const env = loadEnv({ SESSION_SECRET: 'secret' })
    expect(env.DATA_DIR).toBe(join(repoRoot, 'data'))
    expect(env.DATABASE_PATH).toBe(join(repoRoot, 'data', 'homebox.db'))
  })

  // `.env.example` ships exactly these two literals, so they are the paths most
  // installs actually run with — an explicit relative value gets the same
  // treatment as the default, rather than silently meaning `apps/api/data`.
  it('resolves relative values supplied in the environment the same way', () => {
    const env = loadEnv({
      SESSION_SECRET: 'secret',
      DATA_DIR: './data',
      DATABASE_PATH: './data/homebox.db',
    })
    expect(env.DATA_DIR).toBe(join(repoRoot, 'data'))
    expect(env.DATABASE_PATH).toBe(join(repoRoot, 'data', 'homebox.db'))

    expect(resolveDataPath('./custom')).toBe(join(repoRoot, 'custom'))
  })

  // Absolute values are used as given: every test and the e2e suite point the app
  // at a `mkdtemp` directory, and a deploy can point it anywhere on disk.
  it('leaves an absolute data path alone', () => {
    expect(resolveDataPath('/srv/homebox')).toBe('/srv/homebox')
    const env = loadEnv({
      SESSION_SECRET: 'secret',
      DATA_DIR: '/srv/homebox',
      DATABASE_PATH: '/srv/homebox/custom.db',
    })
    expect(env.DATA_DIR).toBe('/srv/homebox')
    expect(env.DATABASE_PATH).toBe('/srv/homebox/custom.db')
  })
})

describe('env log level', () => {
  // `info` rather than silence: an unset level has to be the one that produces
  // logs, or the default installs are the ones with nothing to read.
  it('defaults to info, and takes an explicit level as given', () => {
    expect(loadEnv({ SESSION_SECRET: 'secret' }).LOG_LEVEL).toBe('info')
    expect(loadEnv({ SESSION_SECRET: 'secret', LOG_LEVEL: 'debug' }).LOG_LEVEL).toBe('debug')
    // Empty is what `-e LOG_LEVEL="$UNSET"` and compose's `${LOG_LEVEL}` produce;
    // it has to fall back rather than refuse to boot an optional var.
    expect(loadEnv({ SESSION_SECRET: 'secret', LOG_LEVEL: '' }).LOG_LEVEL).toBe('info')
  })

  // Without this the typo reaches pino and throws from inside Fastify's own
  // construction, where the message does not name the levels that would work.
  it('rejects an unknown level, naming the real ones', () => {
    expect(() => loadEnv({ SESSION_SECRET: 'secret', LOG_LEVEL: 'verbose' })).toThrowError(
      /Unknown LOG_LEVEL "verbose"\. Use one of: fatal, error, warn, info, debug, trace, silent\./,
    )
  })
})
