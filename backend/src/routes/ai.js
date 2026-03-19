import { Router } from 'express'
import registry from '../ai/registry.js'
import { getEmptyCells } from '../ai/gameLogic.js'
import { recordMove } from '../services/aiMetrics.js'

const router = Router()

/**
 * GET /api/v1/ai/implementations
 * Returns all registered AI implementations.
 */
router.get('/implementations', (_req, res) => {
  res.json({ implementations: registry.list() })
})

/**
 * POST /api/v1/ai/move
 * Body: { board, difficulty, player, implementation }
 * Returns: { move, implementation, durationMs }
 */
router.post('/move', async (req, res, next) => {
  try {
    const { board, difficulty, player, implementation: implId, modelId } = req.body

    // Validate board
    if (!Array.isArray(board) || board.length !== 9) {
      return res.status(400).json({ error: 'board must be a 9-element array' })
    }

    // Validate difficulty (not enforced for ML, but kept for other implementations)
    if (implId !== 'ml' && !['easy', 'medium', 'hard'].includes(difficulty)) {
      return res.status(400).json({ error: 'difficulty must be easy, medium, or hard' })
    }

    // Validate player
    if (!['X', 'O'].includes(player)) {
      return res.status(400).json({ error: 'player must be X or O' })
    }

    // Validate implementation
    if (!implId || !registry.has(implId)) {
      return res.status(400).json({
        error: `Unknown implementation '${implId}'. Valid IDs: ${registry.validIds().join(', ')}`,
      })
    }

    // Check there are valid moves
    if (getEmptyCells(board).length === 0) {
      return res.status(400).json({ error: 'No empty cells available' })
    }

    const impl = registry.get(implId)

    const start = Date.now()
    const move = await Promise.resolve(impl.move(board, difficulty, player, modelId))
    const durationMs = Date.now() - start

    recordMove({ implementation: implId, difficulty: difficulty || 'ml', durationMs, cellIndex: move })

    res.json({ move, implementation: implId, durationMs })
  } catch (err) { next(err) }
})

export default router
