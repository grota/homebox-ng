import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    // The Playwright specs in `e2e/` are not vitest tests (they import
    // `@playwright/test`); exclude them from the unit run.
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'test-results/**'],
    // The default 5s is too tight for these. They are jsdom + RTL tests, and the
    // cost is per-file setup (a ~13s module-transform bill each). Measured: a file
    // that finishes in ~1s on its own takes 5–6s under `pnpm test`, where turbo
    // runs all four packages' suites at once — which made a *different* heavy test
    // time out on each run, with a green suite in between.
    //
    // Raising it rather than limiting parallelism: the tests are slow, not stuck,
    // and a suite that is red one run in three trains everyone to ignore it. A real
    // hang still fails, just 15s later.
    testTimeout: 15_000,
  },
})
