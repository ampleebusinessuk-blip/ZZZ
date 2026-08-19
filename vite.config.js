import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend API/WebSocket origin (overridable for different environments).
const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:4000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/ws': { target: API_TARGET, ws: true, changeOrigin: true },
    },
  },
  build: {
    // Split vendor libraries into their own cacheable chunks for faster loads at scale.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('react-dom') || id.includes('react-router') || /node_modules[/\\]react[/\\]/.test(id)) return 'react-vendor'
        },
      },
    },
  },
})
