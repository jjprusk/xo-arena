import { Router } from 'express'
import { getSummary, getHistogram, getHeatmap, getTotal } from '../services/aiMetrics.js'

const router = Router()

/**
 * GET /api/v1/admin/ai/summary
 * Scorecard: per implementation+difficulty totals, avgMs, maxMs.
 */
router.get('/summary', (_req, res) => {
  res.json({ total: getTotal(), rows: getSummary() })
})

/**
 * GET /api/v1/admin/ai/histogram?implementation=&difficulty=
 * Move computation time distribution in 6 buckets.
 */
router.get('/histogram', (req, res) => {
  const { implementation, difficulty } = req.query
  res.json({ histogram: getHistogram(implementation, difficulty) })
})

/**
 * GET /api/v1/admin/ai/heatmap?implementation=&difficulty=
 * Cell selection frequency — 9 values, one per board cell.
 */
router.get('/heatmap', (req, res) => {
  const { implementation, difficulty } = req.query
  res.json({ heatmap: getHeatmap(implementation, difficulty) })
})

export default router
