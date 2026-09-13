import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The dev proxy has to follow the API's own port. `PORT` is read here in the same
// order the server reads it (`apps/api/src/env.ts`): the shell wins, then the
// repo-root `.env`, then the default. Hardcoded to :3000, a moved port proxied to
// whatever else happened to be listening there — and an unrelated server's 401s
// (or a dead port's 500s) read as the API being broken.
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => {
  const apiPort = process.env.PORT || loadEnv(mode, REPO_ROOT, '').PORT || '3000'
  const apiTarget = `http://localhost:${apiPort}`

  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // `styled-components` and `konva` are transitive-only (pnpm does not hoist them
          // into apps/web/node_modules), so match on resolved paths rather than package names.
          manualChunks(id) {
            if (/node_modules[/\\].*(filerobot-image-editor|react-konva|konva|styled-components)[/@]/.test(id)) {
              return 'editor'
            }
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: ['.localhost', '.local', 'thinkpad-x1'],
      proxy: {
        '/trpc': apiTarget,
        '/upload': apiTarget,
        '/file': apiTarget,
      },
    },
  }
})
