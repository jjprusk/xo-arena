import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const app = express()
const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'

// Proxy /api/* and /socket.io/* to the backend (includes WebSocket upgrade)
const backendProxy = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true,
})

app.use('/api', backendProxy)
app.use('/socket.io', backendProxy)

// Serve static frontend files
app.use(express.static(dist))
app.get('*', (_req, res) => res.sendFile(join(dist, 'index.html')))

const server = app.listen(process.env.PORT || 4173, () => {
  console.log(`Frontend serving on port ${process.env.PORT || 4173}`)
})

// Forward WebSocket upgrades to the backend
server.on('upgrade', backendProxy.upgrade)
