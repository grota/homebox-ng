import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = 3000
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.ts',
  // All spec files share ONE e2e database, minted fresh per RUN (see `webServer`
  // below), so files must run one at a time. In parallel, the first-run `/setup`
  // test (00-catalog.spec.ts, which sorts first) and a later spec that provisions
  // the admin would race on the shared DB. `workers: 1` makes the file order (and
  // the shared-DB contract) deterministic.
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build the whole workspace first (this produces `apps/web/dist`), then run
    // the built API — which serves `/trpc` AND the built SPA on the same port.
    //
    // The DB + uploads live in a temp dir minted here, per run, and the EXIT trap
    // removes it when Playwright stops the server. A per-run path is what makes
    // each run start empty: a fixed path cannot work, because Playwright starts
    // this server BEFORE any `globalSetup` runs, so a setup-time `rm` deletes the
    // file out from under a server that already has it open — the run would then
    // serve the previous run's rows (duplicate item types → 409, `/setup` already
    // done → `/login`). `$D` is absolute, so the server's cwd stops mattering too.
    command: 'D=$(mktemp -d) && trap "rm -rf $D" EXIT && pnpm -r build && DATABASE_PATH="$D/e2e.db" DATA_DIR="$D/uploads" pnpm --filter @homebox/api start',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      SESSION_SECRET: 'e2e-secret',
      PORT: String(PORT),
      // Register the deterministic mock detection provider so the unpack e2e spec
      // produces fixed boxes (chair + table) without a real model download.
      DETECTION_MOCK: '1',
    },
  },
})
