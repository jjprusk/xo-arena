// Copyright © 2026 Joe Pruskowski. All rights reserved.
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
  // Expose Server-Timing so the perf-sse-rtt harness (and any browser perf
  // tooling) can read per-leg breakdowns from the move POST.
  exposedHeaders: ['Server-Timing'],
}))

// Better Auth handler — must be mounted BEFORE express.json()
app.all('/api/auth/*', toNodeHandler(auth))

// Silent session + token endpoints — always return 200 so browsers don't
// log 401 in the console for unauthenticated users. The client code
// checks for null user/token rather than relying on HTTP status.
app.get('/api/session', async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    res.json(session ?? { user: null, session: null })
  } catch {
    res.json({ user: null, session: null })
  }
})
app.get('/api/token', async (req, res) => {
  try {
    const result = await auth.api.getToken({ headers: req.headers })
    res.json(result ?? { token: null })
  } catch (err) {
    logger.warn({ err: err.message }, '/api/token failed')
    res.json({ token: null })
  }
})

app.use(express.json({ limit: '50mb' }))

// Request timing middleware
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ms: Date.now() - start,
    }, 'request')
  })
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
