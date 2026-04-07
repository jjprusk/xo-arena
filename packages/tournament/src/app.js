/**
 * Express application setup.
 * Configures CORS, JSON parsing, and mounts routes.
 */

import express from 'express'
import tournamentRouter from './routes/tournaments.js'
import matchRouter from './routes/matches.js'
import botMatchesRouter from './routes/botMatches.js'
import classificationRouter from './routes/classification.js'
import logger from './logger.js'

const app = express()

// ─── Core middleware ──────────────────────────────────────────────────────────

app.use(express.json())

// Basic CORS — allow configured origins or all in development
app.use((req, res, next) => {
  const origin = req.headers.origin
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : null

  if (allowedOrigins === null || (origin && allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*')
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }

  next()
})

// ─── Request logging ──────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'Incoming request')
  next()
})

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/tournaments', tournamentRouter)
app.use('/matches', matchRouter)
app.use('/bot-matches', botMatchesRouter)
app.use('/classification', classificationRouter)

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: '@xo-arena/tournament' })
})

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ─── Error handler ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error')
  res.status(500).json({ error: 'Internal server error' })
})

export default app
