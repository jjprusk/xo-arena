import { Router } from 'express'
import { getLeaderboard } from '../services/userService.js'

const router = Router()

/**
 * GET /api/v1/leaderboard
 * Query params: period (all|monthly|weekly), mode (all|pvp|pvai), limit
 */
router.get('/', async (req, res, next) => {
  try {
    const { period = 'all', mode = 'all', limit, includeBots } = req.query
    const board = await getLeaderboard({
      period,
      mode,
      limit: limit ? Math.min(100, parseInt(limit)) : 50,
      includeBots: includeBots === 'true',
    })
    res.json({ leaderboard: board })
  } catch (err) {
    next(err)
  }
})

export default router
