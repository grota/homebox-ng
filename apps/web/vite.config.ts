import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The Fastify API runs on 3000 in dev; proxy the tRPC endpoint and the
      // upload/file routes so the SPA can call them same-origin.
      '/trpc': 'http://localhost:3000',
      '/upload': 'http://localhost:3000',
      '/file': 'http://localhost:3000',
    },
  },
})
