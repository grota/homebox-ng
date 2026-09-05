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
  },
})
