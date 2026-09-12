import { describe, it, expect } from 'vitest'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DATA_DIR, loadEnv } from '../src/env'

// The workspace root as *this test file* sees it: `apps/api/test/env.test.ts` →
// three levels up.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

describe('env defaults', () => {
  // `pnpm --filter @homebox/api start` runs with `apps/api` as its cwd, so a
  // cwd-relative default put the data dir (uploads, detection model cache) at
  // `apps/api/data`. The default is derived from the module's own location
  // instead, which is what makes it independent of where the process started.
  it('resolves the default DATA_DIR against the workspace root, not the cwd', () => {
    expect(isAbsolute(DEFAULT_DATA_DIR)).toBe(true)
    expect(DEFAULT_DATA_DIR).toBe(join(repoRoot, 'data'))
    // With no DATA_DIR in the environment, `loadEnv` hands back that default.
    expect(loadEnv({ SESSION_SECRET: 'secret' }).DATA_DIR).toBe(DEFAULT_DATA_DIR)
  })

  // An explicit DATA_DIR still wins, and a relative one keeps resolving against
  // the process cwd: an existing install's uploads live where that path has
  // always pointed, so moving it would orphan them.
  it('leaves an explicitly supplied DATA_DIR alone', () => {
    expect(loadEnv({ SESSION_SECRET: 'secret', DATA_DIR: '/srv/homebox' }).DATA_DIR).toBe('/srv/homebox')
    expect(loadEnv({ SESSION_SECRET: 'secret', DATA_DIR: './custom' }).DATA_DIR).toBe('./custom')
  })
})
