import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const BACKEND_URL     = process.env.BACKEND_URL     || 'http://localhost:3000'
const TOURNAMENT_URL  = process.env.TOURNAMENT_URL  || 'http://localhost:3001'

export default defineConfig({
  plugins: [
    react({ jsxRuntime: 'automatic' }),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-dom') || id.includes('react-router-dom') || /\/react\//.test(id)) return 'vendor-react'
          if (id.includes('socket.io-client')) return 'vendor-realtime'
        },
      },
    },
  },
  server: {
    host: true,
    proxy: {
      // Tournament service endpoints
      '/api/tournaments':    { target: TOURNAMENT_URL, changeOrigin: true },
      '/api/matches':        { target: TOURNAMENT_URL, changeOrigin: true },
      '/api/classification': { target: TOURNAMENT_URL, changeOrigin: true },
      '/api/recurring':      { target: TOURNAMENT_URL, changeOrigin: true },
      '/api/bot-matches':    { target: TOURNAMENT_URL, changeOrigin: true },
      // Backend (auth + game API + sockets)
      '/api':       { target: BACKEND_URL, changeOrigin: true },
      '/socket.io': { target: BACKEND_URL, changeOrigin: true, ws: true },
    },
  },
})
