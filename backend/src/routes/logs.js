import { Router } from 'express'
import logger from '../logger.js'

const router = Router()

const VALID_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
const VALID_SOURCES = ['frontend', 'api', 'realtime', 'ai']

/**
 * POST /api/v1/logs
 * Ingests batched frontend log entries.
 */
router.post('/', (req, res) => {
  const { entries } = req.body

  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries must be an array' })
  }

  for (const entry of entries) {
    if (!VALID_LEVELS.includes(entry.level)) continue
    if (!VALID_SOURCES.includes(entry.source)) continue

    const logLevel = entry.level.toLowerCase()
    const pinoLevel = logLevel === 'fatal' ? 'fatal' : logLevel === 'warn' ? 'warn' : logLevel === 'error' ? 'error' : 'info'

    logger[pinoLevel](
      {
        source: entry.source || 'frontend',
        userId: entry.userId || null,
        sessionId: entry.sessionId || null,
        roomId: entry.roomId || null,
        meta: entry.meta || null,
        clientTimestamp: entry.timestamp,
      },
      entry.message,
    )
  }

  res.status(204).end()
})

/**
 * GET /api/v1/logs
 * Log viewer queries — admin only (auth enforcement added in AUTH phase).
 * Placeholder for now.
 */
router.get('/', (_req, res) => {
  res.json({ logs: [], total: 0, message: 'Log viewer API coming in v2' })
})

export default router
