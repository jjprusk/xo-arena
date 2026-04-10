/**
 * Admin API routes for bot match configuration and status.
 *
 * GET  /bot-matches/config   — get global bot match config
 * PATCH /bot-matches/config  — update global bot match config
 * GET  /bot-matches/status   — get current queue/worker status
 */

import { Router } from 'express'
import { requireAuth, requireTournamentAdmin } from '../middleware/auth.js'
import { getActiveCount, getQueueDepth, getActiveJobs } from '../lib/botJobQueue.js'
import db from '@xo-arena/db'
import logger from '../logger.js'

const router = Router()

// ─── GET /bot-matches/config ──────────────────────────────────────────────────

router.get('/config', requireAuth, requireTournamentAdmin, async (_req, res) => {
  try {
    const [concurrencyRow, paceRow] = await Promise.all([
      db.systemConfig.findUnique({ where: { key: 'tournament.botMatch.globalConcurrencyLimit' } }),
      db.systemConfig.findUnique({ where: { key: 'tournament.botMatch.defaultPaceMs' } }),
    ])

    res.json({
      concurrencyLimit: concurrencyRow?.value ?? 4,
      defaultPaceMs: paceRow?.value ?? 0,
    })
  } catch (err) {
    logger.error({ err }, 'Failed to get bot match config')
    res.status(500).json({ error: 'Failed to get bot match config' })
  }
})

// ─── PATCH /bot-matches/config ────────────────────────────────────────────────

router.patch('/config', requireAuth, requireTournamentAdmin, async (req, res) => {
  try {
    const { concurrencyLimit, defaultPaceMs } = req.body

    if (concurrencyLimit !== undefined) {
      if (typeof concurrencyLimit !== 'number' || concurrencyLimit < 1) {
        return res.status(400).json({ error: 'concurrencyLimit must be a number >= 1' })
      }
    }

    if (defaultPaceMs !== undefined) {
      if (typeof defaultPaceMs !== 'number' || defaultPaceMs < 0) {
        return res.status(400).json({ error: 'defaultPaceMs must be a number >= 0' })
      }
    }

    const updates = []

    if (concurrencyLimit !== undefined) {
      updates.push(
        db.systemConfig.upsert({
          where: { key: 'tournament.botMatch.globalConcurrencyLimit' },
          update: { value: concurrencyLimit },
          create: { key: 'tournament.botMatch.globalConcurrencyLimit', value: concurrencyLimit },
        })
      )
    }

    if (defaultPaceMs !== undefined) {
      updates.push(
        db.systemConfig.upsert({
          where: { key: 'tournament.botMatch.defaultPaceMs' },
          update: { value: defaultPaceMs },
          create: { key: 'tournament.botMatch.defaultPaceMs', value: defaultPaceMs },
        })
      )
    }

    await Promise.all(updates)

    // Return current values
    const [concurrencyRow, paceRow] = await Promise.all([
      db.systemConfig.findUnique({ where: { key: 'tournament.botMatch.globalConcurrencyLimit' } }),
      db.systemConfig.findUnique({ where: { key: 'tournament.botMatch.defaultPaceMs' } }),
    ])

    res.json({
      concurrencyLimit: concurrencyRow?.value ?? 4,
      defaultPaceMs: paceRow?.value ?? 0,
    })
  } catch (err) {
    logger.error({ err }, 'Failed to update bot match config')
    res.status(500).json({ error: 'Failed to update bot match config' })
  }
})

// ─── GET /bot-matches/status ──────────────────────────────────────────────────

router.get('/status', requireAuth, requireTournamentAdmin, async (_req, res) => {
  try {
    const [activeCount, queueDepth, jobs] = await Promise.all([
      getActiveCount(),
      getQueueDepth(),
      getActiveJobs(),
    ])

    res.json({ activeCount, queueDepth, jobs })
  } catch (err) {
    logger.error({ err }, 'Failed to get bot match status')
    res.status(500).json({ error: 'Failed to get bot match status' })
  }
})

export default router
