import { Router } from 'express'
import registry from '../ai/registry.js'
import { getEmptyCells, classifyMinimaxMove } from '@xo-arena/ai'
import { recordMove } from '../services/aiMetrics.js'
import { explainMove, getAdaptedMoveForModel, recordHumanMove } from '../services/mlService.js'

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
 * Body: { board, difficulty, player, implementation, modelId, userId?, humanLastMove? }
 * Returns: { move, implementation, durationMs }
 *
 * Optional fields for ML player profiling:
 *   userId       — Clerk user ID of the human player
 *   humanLastMove — cell index of the human's most recent move (before this AI move)
 */
router.post('/move', async (req, res, next) => {
  try {
    const { board, difficulty, player, implementation: implId, modelId, userId, humanLastMove } = req.body

    // Validate board
    if (!Array.isArray(board) || board.length !== 9) {
      return res.status(400).json({ error: 'board must be a 9-element array' })
    }

    // Validate difficulty (not enforced for ML, but kept for other implementations)
    if (implId !== 'ml' && !['novice', 'intermediate', 'advanced', 'master'].includes(difficulty)) {
      return res.status(400).json({ error: 'difficulty must be novice, intermediate, advanced, or master' })
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
    let move

    // For ML models with a signed-in user, attempt profile-adapted move
    if (implId === 'ml' && modelId && userId) {
      try {
        // Record human's last move (fire-and-forget) if provided
        if (typeof humanLastMove === 'number' && humanLastMove >= 0 && humanLastMove <= 8) {
          // Reconstruct board before the human's move
          const boardBeforeHumanMove = [...board]
          boardBeforeHumanMove[humanLastMove] = null
          recordHumanMove(modelId, userId, boardBeforeHumanMove, humanLastMove)
        }

        // Get adapted move (loads engine + profile internally)
        move = await getAdaptedMoveForModel(modelId, board, player, userId)
      } catch (profileErr) {
        // Non-fatal — fall through to normal move
        move = undefined
      }
    }

    if (move === undefined || move === null) {
      move = await Promise.resolve(impl.move(board, difficulty, player, modelId))
    }

    const durationMs = Date.now() - start

    recordMove({ implementation: implId, difficulty: difficulty || 'ml', durationMs, cellIndex: move })

    // Optional move explanation, gated by explain=true query param
    let explanation = null
    if (req.query.explain === 'true') {
      if (implId === 'ml' && modelId) {
        try {
          const exp = await explainMove(modelId, board)
          const legalQVals = exp.qvalues.filter(v => v !== null)
          const sorted = [...legalQVals].sort((a, b) => b - a)
          const confidence = sorted.length >= 2 && sorted[0] !== sorted[1]
            ? Math.min(1, (sorted[0] - sorted[1]) / (Math.abs(sorted[0]) + Math.abs(sorted[1]) + 1e-6))
            : 0
          explanation = { qValues: exp.qvalues, chosenCell: move, confidence: parseFloat(confidence.toFixed(3)) }
        } catch { /* non-fatal */ }
      } else if (implId === 'minimax') {
        const rule = classifyMinimaxMove(board, move, player, difficulty)
        explanation = { rule, chosenCell: move }
      }
    }

    res.json({ move, implementation: implId, durationMs, ...(explanation && { explanation }) })
  } catch (err) { next(err) }
})

export default router
