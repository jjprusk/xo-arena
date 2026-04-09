import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))
const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
  },
  resolve: {
    alias: {
      // Direct path so Docker can resolve this without the workspace symlink.
      // Host:   __dirname = .../frontend  →  ../packages/xo/src/index.js  ✓
      // Docker: __dirname = /app          →  /packages/xo/src/index.js    ✓ (see docker-compose mount)
      '@xo-arena/xo': resolve(__dirname, '../packages/xo/src/index.js'),
    },
  },
  plugins: [
    react({
      jsxRuntime: 'automatic',
    }),
    tailwindcss(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('react-dom') || id.includes('react-router-dom') || /\/react\//.test(id)) return 'vendor-react'
          if (id.includes('recharts')) return 'vendor-charts'
          if (id.includes('socket.io-client')) return 'vendor-realtime'
        },
      },
    },
  },
  server: {
    host: true,
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api': {
        target: 'http://backend:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://backend:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    exclude: ['**/.claude/**', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: { lines: 80 },
    },
  },
})
