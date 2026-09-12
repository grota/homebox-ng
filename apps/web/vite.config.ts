import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
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
      '/trpc': 'http://localhost:3000',
      '/upload': 'http://localhost:3000',
      '/file': 'http://localhost:3000',
    },
  },
})
