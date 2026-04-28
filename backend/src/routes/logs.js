// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import db from '../lib/db.js'
import { getSystemConfig, setSystemConfig } from '../services/skillService.js'
import { appendToStream } from '../lib/eventStream.js'

const router = Router()

const VALID_LEVELS  = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
const VALID_SOURCES = ['frontend', 'api', 'realtime', 'ai']
const DEFAULT_MAX_ENTRIES = 10_000

// ─── Prune oldest logs to stay within the configured limit ───────────────────
async function pruneIfNeeded() {
  const limit = await getSystemConfig('logs.maxEntries', DEFAULT_MAX_ENTRIES)
  if (!limit || limit <= 0) return

  const count = await db.log.count()
  const overflow = count - limit
  if (overflow <= 0) return

  await db.$executeRaw`
    DELETE FROM "logs"
    WHERE id IN (
      SELECT id FROM "logs" ORDER BY timestamp ASC LIMIT ${overflow}
    )
  `
}

// ─── POST /api/v1/logs ────────────────────────────────────────────────────────
// Ingests batched frontend log entries. Public — no auth required.
router.post('/', async (req, res, next) => {
  const { entries } = req.body
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'entries must be an array' })
  }

  const valid = entries.filter(e =>
    VALID_LEVELS.includes(e.level) && VALID_SOURCES.includes(e.source)
  )

  if (valid.length === 0) return res.status(204).end()

  try {
    const rows = valid.map(e => ({
      level:     e.level,
      source:    e.source,
      message:   String(e.message ?? ''),
      userId:    e.userId    || null,
      sessionId: e.sessionId || null,
      roomId:    e.roomId    || null,
      meta:      e.meta      || null,
      timestamp: e.timestamp ? new Date(e.timestamp) : new Date(),
    }))

    await db.log.createMany({ data: rows })

    // Live-tail fan-out for admins. The `admin:logs:entry` channel is
    // broadcast to all SSE subscribers; GET /events/stream already gates by
    // admin role for anything under the `admin:` prefix, so unprivileged
    // tabs never see it.
    for (const row of rows) {
      appendToStream('admin:logs:entry', row, { userId: '*' }).catch(() => {})
    }

    // Prune asynchronously — don't block the response
    pruneIfNeeded().catch(() => {})

    res.status(204).end()
  } catch (err) {
    next(err)
  }
})

// ─── GET /api/v1/logs ─────────────────────────────────────────────────────────
// Returns stored log entries. Admin only.
router.get('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const limit  = Math.min(2000, parseInt(req.query.limit)  || 500)
    const page   = Math.max(1,    parseInt(req.query.page)   || 1)
    const skip   = (page - 1) * limit

    const where = {}
    if (req.query.level  && VALID_LEVELS.includes(req.query.level))   where.level  = req.query.level
    if (req.query.source && VALID_SOURCES.includes(req.query.source)) where.source = req.query.source
    if (req.query.userId)    where.userId    = req.query.userId
    if (req.query.sessionId) where.sessionId = req.query.sessionId
    if (req.query.roomId)    where.roomId    = req.query.roomId
    if (req.query.search)    where.message   = { contains: req.query.search, mode: 'insensitive' }

    const [logs, total] = await Promise.all([
      db.log.findMany({ where, orderBy: { timestamp: 'desc' }, skip, take: limit }),
      db.log.count({ where }),
    ])

    res.json({ logs, total, page, limit })
  } catch (err) {
    next(err)
  }
})

export default router
