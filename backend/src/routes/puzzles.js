import { Router } from 'express'
import { PUZZLE_TYPES } from '../utils/puzzleGenerator.js'

const router = Router()

/**
 * GET /api/v1/puzzles
 * Returns a batch of generated tactical puzzles.
 *
 * Query params:
 *   type  — one of win1 | block1 | fork | survive (default: all types, round-robin)
 *   count — number of puzzles to return (default: 8, max: 20)
 */
router.get('/', (req, res) => {
  const { type } = req.query
  const count = Math.min(20, Math.max(1, parseInt(req.query.count) || 8))

  const types = type && PUZZLE_TYPES[type]
    ? [type]
    : Object.keys(PUZZLE_TYPES)

  const puzzles = []
  let attempts = 0

  while (puzzles.length < count && attempts < count * 10) {
    attempts++
    const t = types[puzzles.length % types.length]
    const puzzle = PUZZLE_TYPES[t]()
    if (puzzle) {
      puzzles.push({
        id: `${t}_${puzzles.length}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        ...puzzle,
      })
    }
  }

  res.json({ puzzles })
})

export default router
