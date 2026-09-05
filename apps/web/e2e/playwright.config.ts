import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = 3000
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: __dirname,
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: path.join(__dirname, 'global-setup.ts'),
  webServer: {
    // Build the whole workspace first (this produces `apps/web/dist`), then run
    // the built API — which serves `/trpc` AND the built SPA on the same port.
    command: 'pnpm -r build && pnpm --filter @homebox/api start',
    url: `${baseURL}/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      DATABASE_PATH: './data/e2e.db',
      SESSION_SECRET: 'e2e-secret',
      DATA_DIR: './data/e2e-uploads',
      PORT: String(PORT),
    },
  },
})
