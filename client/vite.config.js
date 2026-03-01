import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/channels': 'http://localhost:3000',
      '/status':   'http://localhost:3000',
      '/hls':      'http://localhost:3000',
    },
  },
  build: {
    // Output into the root public/ directory so Express serves it unchanged
    outDir: '../public',
    emptyOutDir: true,
  },
})
