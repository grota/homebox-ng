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
      // Every top-level prefix the API registers AND the browser calls, by
      // prefix. A prefix missing here is invisible in every check we own: the
      // browser gets Vite's 404 for a method it doesn't serve (or, worse, Vite's
      // `index.html` with a 200 for a GET, so `res.json()` parses HTML), while
      // e2e and the container both pass — they serve the built API and the SPA on
      // ONE origin, where there is no proxy to be wrong.
      //
      // That is exactly how the backup feature shipped broken in dev: `POST
      // /backups` 404'd and the admin saw "Could not start the backup", while the
      // e2e that creates, downloads and restores a backup stayed green.
      //
      // `/backup` and `/backups` are two separate route families —
      // `app.post('/backup/restore')` and the `/backups` collection with its
      // `/backups/:id/...` actions. `/backup` already matches `/backups` as a
      // prefix; both are listed so neither reads as an oversight.
      proxy: {
        '/trpc': apiTarget,
        '/upload': apiTarget,
        '/file': apiTarget,
        '/backup': apiTarget,
        '/backups': apiTarget,
      },
    },
  }
})
