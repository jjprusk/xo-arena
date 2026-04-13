// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { getLeaderboard } from '../services/userService.js'
import cache from '../utils/cache.js'

const router = Router()

const TTL_MS = 60_000  // 60 seconds

/**
 * GET /api/v1/leaderboard
 * Query params: period (all|monthly|weekly), mode (all|hvh|hva), limit, includeBots
 */
router.get('/', async (req, res, next) => {
  try {
    const period      = req.query.period     ?? 'all'
    const mode        = req.query.mode       ?? 'all'
    const limit       = req.query.limit ? Math.min(100, parseInt(req.query.limit)) : 50
    const includeBots = req.query.includeBots === 'true'

    const cacheKey = `leaderboard:${period}:${mode}:${limit}:${includeBots}`
    const cached   = cache.get(cacheKey)

    if (cached) {
      res.setHeader('X-Cache', 'HIT')
      return res.json({ leaderboard: cached })
    }

    const board = await getLeaderboard({ period, mode, limit, includeBots })
    cache.set(cacheKey, board, TTL_MS)

    res.setHeader('X-Cache', 'MISS')
    res.json({ leaderboard: board })
  } catch (err) {
    next(err)
  }
})

export default router
