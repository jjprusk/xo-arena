/**
 * ML routes — model management, training, sessions, checkpoints, rule sets.
 * All write operations require authentication.
 */

import { Router } from 'express'
import { requireAuth, isAdmin } from '../middleware/auth.js'
import * as svc from '../services/mlService.js'
import { extractRulesFromModel, extractRulesFromEnsemble } from '../services/ruleExtractionService.js'
import { invalidateRuleSetCache } from '../ai/ruleBased.js'
import db from '../lib/db.js'

const router = Router()

// ─── Model limit helper ───────────────────────────────────────────────────────

/**
 * Returns true if the user may create another model; otherwise sends 403 and returns false.
 */
async function checkModelLimit(req, res) {
  const [userRecord, currentCount, defaultLimit] = await Promise.all([
    db.user.findUnique({ where: { betterAuthId: req.auth.userId }, select: { mlModelLimit: true } }),
    db.mLModel.count({ where: { createdBy: req.auth.userId } }),
    svc.getSystemConfig('ml.maxModelsPerUser', 10),
  ])
  const limit = userRecord?.mlModelLimit ?? defaultLimit
  if (limit > 0 && currentCount >= limit) {
    res.status(403).json({ error: `Model limit reached (${limit}). Delete an existing model to create a new one.` })
    return false
  }
  return true
}

// ─── Ownership helper ─────────────────────────────────────────────────────────

/**
 * Loads a model and asserts the requester owns it (or is admin).
 * Returns the model on success; sends 403/404 and returns null on failure.
 * Models with no createdBy (legacy) are treated as unowned — anyone can mutate.
 */
async function assertModelOwner(req, res, modelId) {
  const model = await svc.getModel(modelId)
  if (!model) { res.status(404).json({ error: 'Model not found' }); return null }
  if (model.createdBy && model.createdBy !== req.auth.userId) {
    if (!await isAdmin(req.auth.userId)) {
      res.status(403).json({ error: 'You do not own this model' }); return null
    }
  }
  return model
}

// ─── Models ──────────────────────────────────────────────────────────────────

router.get('/models', async (_req, res, next) => {
  try {
    const models = await svc.listModels()
    res.json({ models })
  } catch (err) { next(err) }
})

/**
 * GET /api/v1/ml/network-config
 * Public — returns DQN neural net defaults and admin-set limits for the create modal.
 */
router.get('/network-config', async (_req, res, next) => {
  try {
    const [defaultHiddenLayers, maxHiddenLayers, maxUnitsPerLayer] = await Promise.all([
      svc.getSystemConfig('ml.dqn.defaultHiddenLayers', [32]),
      svc.getSystemConfig('ml.dqn.maxHiddenLayers', 3),
      svc.getSystemConfig('ml.dqn.maxUnitsPerLayer', 256),
    ])
    res.json({ dqn: { defaultHiddenLayers, maxHiddenLayers, maxUnitsPerLayer } })
  } catch (err) { next(err) }
})

router.post('/models', requireAuth, async (req, res, next) => {
  try {
    const { name, description, algorithm, config } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
    if (!await checkModelLimit(req, res)) return
    const model = await svc.createModel({ name: name.trim(), description, algorithm, config, createdBy: req.auth.userId })
    res.status(201).json({ model })
  } catch (err) { next(err) }
})

router.get('/models/:id', async (req, res, next) => {
  try {
    const model = await svc.getModel(req.params.id)
    if (!model) return res.status(404).json({ error: 'Model not found' })
    res.json({ model })
  } catch (err) { next(err) }
})

router.patch('/models/:id', requireAuth, async (req, res, next) => {
  try {
    if (!await assertModelOwner(req, res, req.params.id)) return
    const { name, description, config } = req.body
    const model = await svc.updateModel(req.params.id, { name, description, config })
    res.json({ model })
  } catch (err) { next(err) }
})

router.delete('/models/:id', requireAuth, async (req, res, next) => {
  try {
    if (!await assertModelOwner(req, res, req.params.id)) return
    await svc.deleteModel(req.params.id)
    res.status(204).end()
  } catch (err) { next(err) }
})

router.post('/models/:id/reset', requireAuth, async (req, res, next) => {
  try {
    if (!await assertModelOwner(req, res, req.params.id)) return
    const model = await svc.resetModel(req.params.id)
    res.json({ model })
  } catch (err) { next(err) }
})

router.post('/models/:id/clone', requireAuth, async (req, res, next) => {
  try {
    if (!await checkModelLimit(req, res)) return
    const { name, description } = req.body
    const model = await svc.cloneModel(req.params.id, { name, description, createdBy: req.auth.userId })
    res.status(201).json({ model })
  } catch (err) { next(err) }
})

router.post('/models/import', requireAuth, async (req, res, next) => {
  try {
    if (!await checkModelLimit(req, res)) return
    const model = await svc.importModel({ ...req.body, createdBy: req.auth.userId })
    res.status(201).json({ model })
  } catch (err) {
    if (err.message === 'name is required') return res.status(400).json({ error: err.message })
    next(err)
  }
})

// ─── Q-table export ───────────────────────────────────────────────────────────

router.get('/models/:id/qtable', async (req, res, next) => {
  try {
    const qtable = await svc.getQTable(req.params.id)
    res.json({ modelId: req.params.id, stateCount: Object.keys(qtable).length, qtable })
  } catch (err) { next(err) }
})

// ─── Move explanation ─────────────────────────────────────────────────────────

router.post('/models/:id/explain', async (req, res, next) => {
  try {
    const { board } = req.body
    if (!Array.isArray(board) || board.length !== 9) {
      return res.status(400).json({ error: 'board must be a 9-element array' })
    }
    const explanation = await svc.explainMove(req.params.id, board)
    res.json(explanation)
  } catch (err) { next(err) }
})

router.post('/models/:id/explain-activations', async (req, res, next) => {
  try {
    const { board } = req.body
    if (!Array.isArray(board) || board.length !== 9) {
      return res.status(400).json({ error: 'board must be a 9-element array' })
    }
    const result = await svc.explainActivations(req.params.id, board)
    res.json(result)
  } catch (err) { next(err) }
})

// ─── Ensemble ────────────────────────────────────────────────────────────────

router.post('/models/ensemble', async (req, res, next) => {
  try {
    const { modelIds, method = 'majority', weights, board, mark = 'X' } = req.body
    if (!Array.isArray(modelIds) || modelIds.length === 0) {
      return res.status(400).json({ error: 'modelIds must be a non-empty array' })
    }
    if (!Array.isArray(board) || board.length !== 9) {
      return res.status(400).json({ error: 'board must be a 9-element array' })
    }
    if (!['majority', 'weighted'].includes(method)) {
      return res.status(400).json({ error: 'method must be majority or weighted' })
    }
    const result = await svc.ensembleMove(modelIds, method, weights, board, mark)
    res.json(result)
  } catch (err) { next(err) }
})

// ─── Training ─────────────────────────────────────────────────────────────────

router.post('/models/:id/train', requireAuth, async (req, res, next) => {
  try {
    if (!await assertModelOwner(req, res, req.params.id)) return
    const { mode, iterations, config } = req.body
    const validModes = ['SELF_PLAY', 'VS_MINIMAX', 'VS_HUMAN']
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` })
    }
    if (!iterations || iterations < 1 || iterations > 100_000) {
      return res.status(400).json({ error: 'iterations must be 1–100,000' })
    }
    const session = await svc.startTraining(req.params.id, { mode, iterations, config })
    res.status(201).json({ session })
  } catch (err) {
    if (err.message === 'Model is already training') return res.status(409).json({ error: err.message })
    if (err.message?.startsWith('Training limit:')) return res.status(429).json({ error: err.message })
    next(err)
  }
})

// ─── Sessions ─────────────────────────────────────────────────────────────────

router.get('/models/:id/sessions', async (req, res, next) => {
  try {
    const sessions = await svc.getModelSessions(req.params.id)
    if (req.query.format === 'csv') {
      const keys = ['id', 'mode', 'iterations', 'status', 'startedAt', 'completedAt']
      const header = keys.join(',')
      const lines  = sessions.map(s => keys.map(k => s[k] ?? '').join(','))
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="sessions_${req.params.id}.csv"`)
      return res.send([header, ...lines].join('\n'))
    }
    res.json({ sessions })
  } catch (err) { next(err) }
})

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const session = await svc.getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    res.json({ session })
  } catch (err) { next(err) }
})

router.get('/sessions/:id/episodes', async (req, res, next) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1)
    const limit  = Math.min(500, parseInt(req.query.limit) || 200)
    const format = req.query.format
    const data   = await svc.getSessionEpisodes(req.params.id, { page, limit })

    if (format === 'csv') {
      const keys = ['episodeNum', 'outcome', 'totalMoves', 'avgQDelta', 'epsilon', 'durationMs']
      const header = keys.join(',')
      const lines  = data.episodes.map(r => keys.map(k => r[k] ?? '').join(','))
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="episodes_${req.params.id}.csv"`)
      return res.send([header, ...lines].join('\n'))
    }

    res.json(data)
  } catch (err) { next(err) }
})

router.post('/sessions/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const session = await svc.getSession(req.params.id)
    if (!session) return res.status(404).json({ error: 'Session not found' })
    if (!await assertModelOwner(req, res, session.modelId)) return
    await svc.cancelSession(req.params.id)
    res.status(204).end()
  } catch (err) { next(err) }
})

// ─── Export / Import ──────────────────────────────────────────────────────────

router.get('/models/:id/export', async (req, res, next) => {
  try {
    const data = await svc.exportModel(req.params.id)
    const filename = `${data.name.replace(/\s+/g, '_')}.ml.json`
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.json(data)
  } catch (err) { next(err) }
})

// ─── Opening book ─────────────────────────────────────────────────────────────

router.get('/models/:id/opening-book', async (req, res, next) => {
  try {
    const data = await svc.getOpeningBook(req.params.id)
    res.json(data)
  } catch (err) { next(err) }
})

// ─── Checkpoints ──────────────────────────────────────────────────────────────

router.post('/models/:id/checkpoint', requireAuth, async (req, res, next) => {
  try {
    if (!await assertModelOwner(req, res, req.params.id)) return
    const checkpoint = await svc.saveCheckpoint(req.params.id)
    res.status(201).json({ checkpoint })
  } catch (err) { next(err) }
})

router.get('/models/:id/checkpoints', async (req, res, next) => {
  try {
    const checkpoints = await svc.listCheckpoints(req.params.id)
    res.json({ checkpoints })
  } catch (err) { next(err) }
})

router.get('/models/:id/checkpoints/:cpId', async (req, res, next) => {
  try {
    const checkpoint = await svc.getCheckpoint(req.params.id, req.params.cpId)
    res.json({ checkpoint })
  } catch (err) { next(err) }
})

router.post('/models/:id/checkpoints/:cpId/restore', requireAuth, async (req, res, next) => {
  try {
    if (!await assertModelOwner(req, res, req.params.id)) return
    const model = await svc.restoreCheckpoint(req.params.id, req.params.cpId)
    res.json({ model })
  } catch (err) { next(err) }
})

// ─── ELO history ─────────────────────────────────────────────────────────────

router.get('/models/:id/elo-history', async (req, res, next) => {
  try {
    const history = await svc.getEloHistory(req.params.id)
    res.json({ history })
  } catch (err) { next(err) }
})

// ─── Benchmark ───────────────────────────────────────────────────────────────

router.post('/models/:id/benchmark', requireAuth, async (req, res, next) => {
  try {
    const benchmark = await svc.startBenchmark(req.params.id)
    res.status(201).json({ benchmark })
  } catch (err) { next(err) }
})

router.get('/models/:id/benchmarks', async (req, res, next) => {
  try {
    const benchmarks = await svc.listBenchmarks(req.params.id)
    res.json({ benchmarks })
  } catch (err) { next(err) }
})

router.get('/benchmark/:id', async (req, res, next) => {
  try {
    const benchmark = await svc.getBenchmark(req.params.id)
    if (!benchmark) return res.status(404).json({ error: 'Benchmark not found' })
    res.json({ benchmark })
  } catch (err) { next(err) }
})

// ─── Head-to-head ─────────────────────────────────────────────────────────────

router.post('/models/:id/versus/:id2', requireAuth, async (req, res, next) => {
  try {
    const games = Math.min(1000, Math.max(1, parseInt(req.body.games) || 100))
    const result = await svc.runVersus(req.params.id, req.params.id2, games)
    res.json(result)
  } catch (err) { next(err) }
})

// ─── Hyperparameter Search ────────────────────────────────────────────────────

router.post('/models/:id/hypersearch', requireAuth, async (req, res, next) => {
  try {
    if (!await assertModelOwner(req, res, req.params.id)) return
    const { paramGrid, gamesPerConfig } = req.body
    const result = await svc.startHyperparamSearch(req.params.id, { paramGrid, gamesPerConfig })
    res.json(result)
  } catch (err) {
    if (err.message === 'Model not found') return res.status(404).json({ error: err.message })
    next(err)
  }
})

// ─── Tournament ───────────────────────────────────────────────────────────────

router.post('/tournament', requireAuth, async (req, res, next) => {
  try {
    const { modelIds, gamesPerPair } = req.body
    const tournament = await svc.startTournament({ modelIds, gamesPerPair })
    res.status(201).json({ tournament })
  } catch (err) {
    if (err.message.includes('at least 2')) return res.status(400).json({ error: err.message })
    next(err)
  }
})

router.get('/tournaments', async (req, res, next) => {
  try {
    const tournaments = await svc.listTournaments()
    res.json({ tournaments })
  } catch (err) { next(err) }
})

router.get('/tournament/:id', async (req, res, next) => {
  try {
    const tournament = await svc.getTournament(req.params.id)
    if (!tournament) return res.status(404).json({ error: 'Tournament not found' })
    res.json({ tournament })
  } catch (err) { next(err) }
})

// ─── Player Profiles ──────────────────────────────────────────────────────────

router.get('/models/:id/player-profiles', async (req, res, next) => {
  try {
    const profiles = await svc.getPlayerProfiles(req.params.id)
    res.json({ profiles })
  } catch (err) { next(err) }
})

router.get('/models/:id/player-profiles/:userId', async (req, res, next) => {
  try {
    const profile = await svc.getPlayerProfile(req.params.id, req.params.userId)
    if (!profile) return res.status(404).json({ error: 'Profile not found' })
    res.json({ profile })
  } catch (err) { next(err) }
})

router.post('/models/:id/player-profiles/:userId/game-end', async (req, res, next) => {
  try {
    svc.updatePlayerTendencies(req.params.id, req.params.userId)
    res.status(204).end()
  } catch (err) { next(err) }
})

// ─── Rule Sets ───────────────────────────────────────────────────────────────

/** GET /ml/rulesets — list all rule sets (summary, no full rule arrays) */
router.get('/rulesets', async (_req, res, next) => {
  try {
    const sets = await db.ruleSet.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ ruleSets: sets })
  } catch (err) { next(err) }
})

/** POST /ml/rulesets — create a rule set and optionally run extraction */
router.post('/rulesets', requireAuth, async (req, res, next) => {
  try {
    const { name, description, sourceModels } = req.body
    if (!name) return res.status(400).json({ error: 'name is required' })

    let rules = []
    if (Array.isArray(sourceModels) && sourceModels.length > 0) {
      rules = sourceModels.length === 1
        ? (await extractRulesFromModel(sourceModels[0].modelId)).rules
        : await extractRulesFromEnsemble(sourceModels)
    }

    const rs = await db.ruleSet.create({
      data: { name, description: description || null, rules, sourceModels: sourceModels || [] },
    })
    res.status(201).json({ ruleSet: rs })
  } catch (err) { next(err) }
})

/** GET /ml/rulesets/:id — get one rule set with full rules */
router.get('/rulesets/:id', async (req, res, next) => {
  try {
    const rs = await db.ruleSet.findUnique({ where: { id: req.params.id } })
    if (!rs) return res.status(404).json({ error: 'Rule set not found' })
    res.json({ ruleSet: rs })
  } catch (err) { next(err) }
})

/** PATCH /ml/rulesets/:id — update name, description, or rules (priority/enabled) */
router.patch('/rulesets/:id', requireAuth, async (req, res, next) => {
  try {
    const { name, description, rules } = req.body
    const data = {}
    if (name !== undefined) data.name = name
    if (description !== undefined) data.description = description
    if (rules !== undefined) data.rules = rules
    const rs = await db.ruleSet.update({ where: { id: req.params.id }, data })
    invalidateRuleSetCache(req.params.id)
    res.json({ ruleSet: rs })
  } catch (err) { next(err) }
})

/** DELETE /ml/rulesets/:id */
router.delete('/rulesets/:id', requireAuth, async (req, res, next) => {
  try {
    await db.ruleSet.delete({ where: { id: req.params.id } })
    invalidateRuleSetCache(req.params.id)
    res.status(204).end()
  } catch (err) { next(err) }
})

/** POST /ml/rulesets/:id/extract — re-run extraction from source models */
router.post('/rulesets/:id/extract', requireAuth, async (req, res, next) => {
  try {
    const rs = await db.ruleSet.findUnique({ where: { id: req.params.id } })
    if (!rs) return res.status(404).json({ error: 'Rule set not found' })

    // Allow caller to override source models
    const sourceModels = req.body.sourceModels || rs.sourceModels
    if (!Array.isArray(sourceModels) || sourceModels.length === 0) {
      return res.status(400).json({ error: 'No source models specified' })
    }

    const rules = sourceModels.length === 1
      ? (await extractRulesFromModel(sourceModels[0].modelId)).rules
      : await extractRulesFromEnsemble(sourceModels)

    const updated = await db.ruleSet.update({
      where: { id: req.params.id },
      data: { rules, sourceModels },
    })
    invalidateRuleSetCache(req.params.id)
    res.json({ ruleSet: updated })
  } catch (err) { next(err) }
})

export default router
