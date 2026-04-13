import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
const __dirname = dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'))

const BACKEND_URL     = process.env.BACKEND_URL     || 'http://localhost:3000'
const TOURNAMENT_URL  = process.env.TOURNAMENT_URL  || 'http://localhost:3001'

export default defineConfig(({ mode }) => ({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    exclude: ['**/.claude/**', '**/node_modules/**'],
  },
  resolve: {
    alias: {
      // Direct path so Docker can resolve this without the workspace symlink.
      // Host:   __dirname = .../landing  →  ../packages/xo/src/index.js  ✓
      // Docker: __dirname = /app          →  /packages/xo/src/index.js    ✓ (see docker-compose mount)
      '@xo-arena/xo':       resolve(__dirname, '../packages/xo/src/index.js'),
      '@xo-arena/nav':      resolve(__dirname, '../packages/nav/src/index.js'),
      '@xo-arena/ai':       resolve(__dirname, '../packages/ai/src/index.js'),
      '@callidity/game-xo': resolve(__dirname, '../packages/game-xo/src/index.js'),
    },
    // Force packages' imports to resolve from the project root's node_modules.
    // Without this, Node resolution from /packages/* can't find /app/node_modules/.
    dedupe: ['react', 'react-dom', 'react-router-dom', 'zustand'],
  },
  define: {
    // Append '+' in dev/staging builds so it's clear the image may have
    // unreleased changes beyond the tagged version.
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(
      mode === 'production' ? version : `${version}+`
    ),
  },
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
          if (id.includes('packages/game-xo')) return 'game-xo'
        },
      },
    },
  },
  server: {
    host: true,
    port: 5174,
    watch: {
      usePolling: true,
      interval: 300,
    },
    fs: {
      // Allow serving files from parent directory so /packages/xo can be served.
      allow: ['..'],
    },
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
}))
