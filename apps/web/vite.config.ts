import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/trpc': 'http://localhost:3000',
      '/upload': 'http://localhost:3000',
      '/file': 'http://localhost:3000',
    },
  },
})
