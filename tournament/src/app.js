// Copyright © 2026 Joe Pruskowski. All rights reserved.
import express from 'express'
import cors from 'cors'
import logger from './logger.js'

const app = express()

const allowedOrigins = [
  ...(process.env.FRONTEND_URL || 'http://localhost:5174')
    .split(',').map(o => o.trim()).filter(Boolean),
]

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS: origin ${origin} not allowed`))
  },
  credentials: true,
}))

app.use(express.json())

app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    logger.info({ method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - start }, 'request')
  })
  next()
})

app.get('/health', (_req, res) => res.json({ status: 'ok' }))

export function registerRoutes(app, routes) {
  for (const [path, router] of Object.entries(routes)) {
    app.use(`/api${path}`, router)
  }
}

app.use((err, _req, res, _next) => {
  logger.error({ err }, 'unhandled error')
  const status = err.status || 500
  res.status(status).json({ error: err.message || 'Internal server error' })
})

export default app
