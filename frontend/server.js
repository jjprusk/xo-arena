import express from 'express'
import compression from 'compression'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'
const TOURNAMENT_URL = process.env.TOURNAMENT_URL || 'http://localhost:3001'

// Gzip all responses
app.use(compression())

// Proxy tournament API paths to the tournament service (must be before the backend proxy).
const tournamentProxy = createProxyMiddleware({
  target: TOURNAMENT_URL,
  changeOrigin: true,
  pathFilter: ['/api/tournaments', '/api/matches'],
})
app.use(tournamentProxy)

// Proxy /api/* and /socket.io/* to the backend, preserving the full path.
// pathFilter keeps the prefix intact (unlike app.use('/api', proxy) which strips it).
const backendProxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true,
  pathFilter: ['/api', '/socket.io'],
})

app.use(backendProxy)

// Serve static frontend files.
// Hashed assets (dist/assets/*) are cached for 1 year; index.html is never cached
// so users always get the latest entry point.
app.use(express.static(dist, {
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache')
    }
  },
}))
app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))

const server = app.listen(process.env.PORT || 4173, () => {
  console.log(`Frontend serving on port ${process.env.PORT || 4173}`)
})

// Forward WebSocket upgrades to the backend
server.on('upgrade', backendProxy.upgrade)
