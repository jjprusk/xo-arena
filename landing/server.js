import express from 'express'
import compression from 'compression'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')

const BACKEND_URL    = process.env.BACKEND_URL    || 'http://localhost:3000'
const TOURNAMENT_URL = process.env.TOURNAMENT_URL || 'http://localhost:3001'

app.use(compression())

// Tournament service endpoints — must be registered before the general /api proxy
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

// Backend: auth, user API, sockets
const backendProxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true,
  pathFilter: ['/api', '/socket.io'],
})
app.use(backendProxy)

app.use(express.static(dist, {
  maxAge: '1y',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
  },
}))
app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))

const server = app.listen(process.env.PORT || 4174, () => {
  console.log(`AI Arena landing serving on port ${process.env.PORT || 4174}`)
})
server.on('upgrade', backendProxy.upgrade)
process.on('uncaughtException', (err) => { console.error('Uncaught:', err); process.exit(1) })
