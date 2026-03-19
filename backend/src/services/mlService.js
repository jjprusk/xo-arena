/**
 * ML Service — CRUD, training orchestration, in-memory cache.
 *
 * Training runs as a background setImmediate loop, yielding every
 * BATCH_SIZE episodes so the event loop stays responsive. Progress
 * is broadcast via Socket.io to the room `ml:session:{id}`.
 */

import db from '../lib/db.js'
import { QLearningEngine, runEpisode, DEFAULT_CONFIG } from '../ai/qLearning.js'
import { minimaxMove } from '../ai/minimax.js'
import logger from '../logger.js'

// ─── Socket.io reference ────────────────────────────────────────────────────
let _io = null
export function setIO(io) { _io = io }

// ─── In-memory caches ───────────────────────────────────────────────────────
/** modelId → QLearningEngine (loaded on first move, invalidated after training) */
const engineCache = new Map()

/** sessionId → true  (signals background loop to stop) */
const cancelledSessions = new Set()

// ─── Model CRUD ─────────────────────────────────────────────────────────────

export async function listModels() {
  return db.mLModel.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sessions: true } } },
  })
}

export async function createModel({ name, description, algorithm = 'Q_LEARNING', config = {} }) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }
  return db.mLModel.create({
    data: { name, description: description || null, algorithm, qtable: {}, config: mergedConfig },
  })
}

export async function getModel(id) {
  return db.mLModel.findUnique({
    where: { id },
    include: { _count: { select: { sessions: true, checkpoints: true, benchmarks: true } } },
  })
}

export async function updateModel(id, { name, description, config }) {
  return db.mLModel.update({
    where: { id },
    data: {
      ...(name        !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(config      !== undefined && { config }),
    },
  })
}

export async function deleteModel(id) {
  engineCache.delete(id)
  return db.mLModel.delete({ where: { id } })
}

export async function resetModel(id) {
  engineCache.delete(id)
  const model = await db.mLModel.findUnique({ where: { id } })
  if (!model) throw new Error('Model not found')
  const freshConfig = { ...model.config, currentEpsilon: model.config.epsilonStart ?? DEFAULT_CONFIG.epsilonStart }
  return db.mLModel.update({
    where: { id },
    data: { qtable: {}, totalEpisodes: 0, status: 'IDLE', config: freshConfig },
  })
}

export async function cloneModel(id, { name, description }) {
  const src = await db.mLModel.findUnique({ where: { id } })
  if (!src) throw new Error('Source model not found')
  return db.mLModel.create({
    data: {
      name: name || `${src.name} (copy)`,
      description: description || src.description,
      algorithm: src.algorithm,
      qtable: src.qtable,
      config: src.config,
      totalEpisodes: src.totalEpisodes,
      eloRating: src.eloRating,
    },
  })
}

// ─── Session / Episode queries ───────────────────────────────────────────────

export async function getModelSessions(modelId) {
  return db.trainingSession.findMany({
    where: { modelId },
    orderBy: { startedAt: 'desc' },
    include: { _count: { select: { episodes: true } } },
  })
}

export async function getSession(id) {
  return db.trainingSession.findUnique({
    where: { id },
    include: {
      model: { select: { id: true, name: true } },
      _count: { select: { episodes: true } },
    },
  })
}

export async function getSessionEpisodes(sessionId, { page = 1, limit = 200 } = {}) {
  const skip = (page - 1) * limit
  const [episodes, total] = await Promise.all([
    db.trainingEpisode.findMany({
      where: { sessionId },
      orderBy: { episodeNum: 'asc' },
      skip,
      take: limit,
    }),
    db.trainingEpisode.count({ where: { sessionId } }),
  ])
  return { episodes, total, page, limit }
}

// ─── Checkpoints ─────────────────────────────────────────────────────────────

export async function listCheckpoints(modelId) {
  return db.mLCheckpoint.findMany({
    where: { modelId },
    orderBy: { episodeNum: 'desc' },
    select: { id: true, modelId: true, episodeNum: true, epsilon: true, eloRating: true, createdAt: true },
  })
}

export async function restoreCheckpoint(modelId, checkpointId) {
  const cp = await db.mLCheckpoint.findUnique({ where: { id: checkpointId } })
  if (!cp || cp.modelId !== modelId) throw new Error('Checkpoint not found')
  engineCache.delete(modelId)
  const newConfig = await db.mLModel.findUnique({ where: { id: modelId }, select: { config: true } })
  return db.mLModel.update({
    where: { id: modelId },
    data: {
      qtable: cp.qtable,
      totalEpisodes: cp.episodeNum,
      eloRating: cp.eloRating,
      status: 'IDLE',
      config: { ...newConfig.config, currentEpsilon: cp.epsilon },
    },
  })
}

// ─── Q-table / move ──────────────────────────────────────────────────────────

export async function getQTable(modelId) {
  const model = await db.mLModel.findUnique({ where: { id: modelId }, select: { qtable: true } })
  return model?.qtable ?? {}
}

export async function getMoveForModel(modelId, board) {
  if (!engineCache.has(modelId)) {
    const model = await db.mLModel.findUnique({ where: { id: modelId } })
    if (!model) throw new Error(`ML model ${modelId} not found`)
    const engine = new QLearningEngine(model.config)
    engine.loadQTable(model.qtable)
    engineCache.set(modelId, engine)
  }
  return engineCache.get(modelId).chooseAction(board, false) // pure exploitation
}

export async function explainMove(modelId, board) {
  if (!engineCache.has(modelId)) await getMoveForModel(modelId, board)
  const engine = engineCache.get(modelId)
  const qvalues = engine.explainBoard(board)
  const best = qvalues.reduce((b, v, i) => v !== null && (b === -1 || v > qvalues[b]) ? i : b, -1)
  return { qvalues, bestCell: best, epsilon: engine.epsilon, stateCount: engine.stateCount }
}

// ─── Training ────────────────────────────────────────────────────────────────

export async function startTraining(modelId, { mode, iterations, config = {} }) {
  const model = await getModel(modelId)
  if (!model) throw new Error('Model not found')
  if (model.status === 'TRAINING') throw new Error('Model is already training')
  if (iterations < 1 || iterations > 100_000) throw new Error('iterations must be 1–100,000')

  const session = await db.trainingSession.create({
    data: { modelId, mode, iterations, status: 'RUNNING', config },
  })
  await db.mLModel.update({ where: { id: modelId }, data: { status: 'TRAINING' } })

  // Fire-and-forget background loop
  setImmediate(() => _runTraining(model, session, { mode, iterations, config }))
  return session
}

export async function cancelSession(sessionId) {
  cancelledSessions.add(sessionId)
  // DB update happens inside the loop when it detects cancellation;
  // if session already completed, update it here as fallback
  const s = await db.trainingSession.findUnique({ where: { id: sessionId } })
  if (s && s.status === 'RUNNING') {
    await db.trainingSession.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    })
  }
}

// ─── Training loop (private) ─────────────────────────────────────────────────

const BATCH_SIZE     = 50   // episodes per DB batch insert
const CHECKPOINT_GAP = 1000 // save checkpoint every N episodes

async function _runTraining(model, session, { mode, iterations, config }) {
  const { id: sessionId, modelId } = { id: session.id, modelId: model.id }

  // Build engine from current model state
  const engine = new QLearningEngine(model.config)
  engine.loadQTable(model.qtable)

  // Build opponent function
  const difficulty = config.difficulty || 'medium'
  const opponentFn = mode === 'VS_MINIMAX'
    ? (board, player) => minimaxMove(board, difficulty, player)
    : null
  const mlMark = mode === 'SELF_PLAY' ? 'both' : (config.mlMark || 'X')

  const PROGRESS_INTERVAL = Math.max(BATCH_SIZE, Math.floor(iterations / 20))
  const episodeBatch = []
  let wins = 0, losses = 0, draws = 0, totalQDelta = 0

  try {
    for (let i = 0; i < iterations; i++) {
      // Cooperative cancellation check
      if (cancelledSessions.has(sessionId)) {
        cancelledSessions.delete(sessionId)
        await _finishSession(sessionId, modelId, engine, iterations, 'CANCELLED', { wins, losses, draws, totalQDelta, i })
        return
      }

      const t0 = Date.now()
      const result = runEpisode(engine, mlMark, opponentFn)
      const durationMs = Date.now() - t0

      if (result.outcome === 'WIN')       wins++
      else if (result.outcome === 'LOSS') losses++
      else                                draws++
      totalQDelta += result.avgQDelta

      episodeBatch.push({
        sessionId, episodeNum: i + 1,
        outcome: result.outcome, totalMoves: result.totalMoves,
        avgQDelta: result.avgQDelta, epsilon: result.epsilon, durationMs,
      })

      // Batch DB write
      if (episodeBatch.length >= BATCH_SIZE || i === iterations - 1) {
        await db.trainingEpisode.createMany({ data: episodeBatch })
        episodeBatch.length = 0
      }

      // Checkpoint
      if ((i + 1) % CHECKPOINT_GAP === 0) {
        await db.mLCheckpoint.create({
          data: { modelId, episodeNum: model.totalEpisodes + i + 1, qtable: engine.toJSON(), epsilon: engine.epsilon, eloRating: model.eloRating },
        })
      }

      // Progress broadcast + event-loop yield
      if ((i + 1) % PROGRESS_INTERVAL === 0 || i === iterations - 1) {
        const done = i + 1
        _emit(`ml:session:${sessionId}`, 'ml:progress', {
          sessionId, episode: done, totalEpisodes: iterations,
          winRate:  done > 0 ? wins  / done : 0,
          lossRate: done > 0 ? losses / done : 0,
          drawRate: done > 0 ? draws  / done : 0,
          avgQDelta: done > 0 ? totalQDelta / done : 0,
          epsilon: engine.epsilon,
          outcomes: { wins, losses, draws },
        })
        await new Promise(r => setImmediate(r))
      }
    }

    await _finishSession(sessionId, modelId, engine, iterations, 'COMPLETED', { wins, losses, draws, totalQDelta, i: iterations })
  } catch (err) {
    logger.error({ err, sessionId, modelId }, 'Training failed')
    await db.mLModel.update({ where: { id: modelId }, data: { status: 'IDLE' } })
    await db.trainingSession.update({ where: { id: sessionId }, data: { status: 'FAILED', completedAt: new Date() } })
    _emit(`ml:session:${sessionId}`, 'ml:error', { sessionId, error: err.message })
  }
}

async function _finishSession(sessionId, modelId, engine, iterations, status, { wins, losses, draws, totalQDelta }) {
  const summary = {
    wins, losses, draws,
    winRate:    iterations > 0 ? wins / iterations : 0,
    avgQDelta:  iterations > 0 ? totalQDelta / iterations : 0,
    finalEpsilon: engine.epsilon,
    stateCount: engine.stateCount,
  }
  const updatedConfig = await db.mLModel.findUnique({ where: { id: modelId }, select: { config: true } })
  await db.$transaction([
    db.mLModel.update({
      where: { id: modelId },
      data: {
        qtable: engine.toJSON(),
        status: 'IDLE',
        totalEpisodes: { increment: iterations },
        config: { ...updatedConfig.config, currentEpsilon: engine.epsilon },
      },
    }),
    db.trainingSession.update({
      where: { id: sessionId },
      data: { status, completedAt: new Date(), summary },
    }),
  ])
  engineCache.delete(modelId)
  _emit(`ml:session:${sessionId}`, status === 'COMPLETED' ? 'ml:complete' : 'ml:cancelled', { sessionId, summary })
  logger.info({ sessionId, modelId, status, ...summary }, 'Training finished')
}

function _emit(room, event, data) {
  if (_io) _io.to(room).emit(event, data)
}
