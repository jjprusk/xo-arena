import express from 'express'
import compression from 'compression'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readFileSync } from 'fs'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')
const { version: LANDING_VERSION } = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))

// Support both short (local dev) and long (Railway prod) env var names
const BACKEND_URL    = process.env.BACKEND_PRIVATE_URL    || process.env.BACKEND_URL    || 'http://localhost:3000'
const TOURNAMENT_URL = process.env.TOURNAMENT_PRIVATE_URL || process.env.TOURNAMENT_URL || 'http://localhost:3001'

app.use(compression())

// ── Landing version — checked by smoke tests to confirm successful deploy ────
app.get('/landing-version', (_req, res) => res.json({ version: LANDING_VERSION }))

// ── Tournament service endpoints (must come before the /api catch-all) ──────
const tournamentPaths = [
  '/api/tournaments',
  '/api/matches',
  '/api/classification',
  '/api/recurring',
  '/api/bot-matches',
]
app.use(createProxyMiddleware({
  target: TOURNAMENT_URL,
  changeOrigin: true,
  pathFilter: tournamentPaths,
}))

// ── Backend: auth, user API, WebSockets ──────────────────────────────────────
const backendProxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true,
  pathFilter: ['/api', '/socket.io'],
  on: {
    proxyReq: (proxyReq, req) => {
      // Forward real client IP to backend
      const forwarded = req.headers['x-forwarded-for'] || req.socket.remoteAddress
      if (forwarded) proxyReq.setHeader('X-Forwarded-For', forwarded)
      proxyReq.setHeader('X-Forwarded-Host', req.headers.host || '')
      proxyReq.setHeader('X-Forwarded-Proto', 'https')
    },
  },
})
app.use(backendProxy)

// ── Landing platform static files ────────────────────────────────────────────
app.use(express.static(dist, {
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
  },
}))
app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(process.env.PORT || 4174, () => {
  console.log(`AI Arena landing serving on port ${process.env.PORT || 4174}`)
  console.log(`  Backend:    ${BACKEND_URL}`)
  console.log(`  Tournament: ${TOURNAMENT_URL}`)
})
server.on('upgrade', backendProxy.upgrade)
process.on('uncaughtException', (err) => { console.error('Uncaught:', err); process.exit(1) })
