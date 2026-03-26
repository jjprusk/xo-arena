import express from 'express'
import cors from 'cors'
import { toNodeHandler } from 'better-auth/node'
import { auth } from './lib/auth.js'
import logger from './logger.js'

const app = express()

const allowedOrigins = [
  ...(process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',').map(o => o.trim()).filter(Boolean),
  'https://appleid.apple.com',
]
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}))

// Better Auth handler — must be mounted BEFORE express.json()
app.all('/api/auth/*', toNodeHandler(auth))

app.use(express.json())

// Request logger middleware
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, 'request')
  next()
})

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }))

// API v1 routes (registered after app is created)
export function registerRoutes(app, routes) {
  for (const [path, router] of Object.entries(routes)) {
    app.use(`/api/v1${path}`, router)
  }
}

// Global error handler
app.use((err, _req, res, _next) => {
  logger.error({ err }, 'unhandled error')
  const status = err.status || 500
  res.status(status).json({ error: err.message || 'Internal server error' })
})

export default app
