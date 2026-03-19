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
import { getEmptyCells } from '../ai/gameLogic.js'
import { proportionPValue, twoProportionPValue } from '../ai/stats.js'
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

// ─── Opening book ────────────────────────────────────────────────────────────

export async function getOpeningBook(modelId) {
  const model = await db.mLModel.findUnique({ where: { id: modelId }, select: { qtable: true } })
  if (!model) throw new Error('Model not found')
  const qtable = model.qtable

  // Agent's first-move Q-values from the all-empty state
  const emptyKey = '.........'
  const firstMoveQVals = qtable[emptyKey] ?? Array(9).fill(0)

  // Agent's response Q-values to each possible single opponent opening
  const responses = []
  for (let i = 0; i < 9; i++) {
    const cells = Array(9).fill('.')
    cells[i] = 'O'
    const key = cells.join('')
    const qvals = qtable[key] ?? Array(9).fill(0)
    responses.push({ opponentCell: i, qvals })
  }

  return { firstMoveQVals, responses, stateCount: Object.keys(qtable).length }
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

// ─── ELO ─────────────────────────────────────────────────────────────────────

const ELO_K = 32

function _expectedScore(rA, rB) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400))
}

export async function updateElo(modelAId, modelBId, outcome) {
  // outcome: 'WIN' (A wins), 'LOSS' (A loses), 'DRAW'
  const [a, b] = await Promise.all([
    db.mLModel.findUnique({ where: { id: modelAId }, select: { eloRating: true } }),
    db.mLModel.findUnique({ where: { id: modelBId }, select: { eloRating: true } }),
  ])
  const eA = _expectedScore(a.eloRating, b.eloRating)
  const eB = _expectedScore(b.eloRating, a.eloRating)
  const sA = outcome === 'WIN' ? 1 : outcome === 'DRAW' ? 0.5 : 0
  const sB = 1 - sA
  const newA = parseFloat((a.eloRating + ELO_K * (sA - eA)).toFixed(2))
  const newB = parseFloat((b.eloRating + ELO_K * (sB - eB)).toFixed(2))
  await db.$transaction([
    db.mLModel.update({ where: { id: modelAId }, data: { eloRating: newA } }),
    db.mLModel.update({ where: { id: modelBId }, data: { eloRating: newB } }),
    db.mLEloHistory.create({ data: { modelId: modelAId, eloRating: newA, delta: parseFloat((newA - a.eloRating).toFixed(2)), opponentId: modelBId, opponentType: 'ML', outcome: outcome === 'WIN' ? 'WIN' : outcome === 'DRAW' ? 'DRAW' : 'LOSS' } }),
    db.mLEloHistory.create({ data: { modelId: modelBId, eloRating: newB, delta: parseFloat((newB - b.eloRating).toFixed(2)), opponentId: modelAId, opponentType: 'ML', outcome: outcome === 'WIN' ? 'LOSS' : outcome === 'DRAW' ? 'DRAW' : 'WIN' } }),
  ])
  return { newA, newB }
}

export async function getEloHistory(modelId) {
  return db.mLEloHistory.findMany({
    where: { modelId },
    orderBy: { recordedAt: 'asc' },
  })
}

// ─── Benchmark ───────────────────────────────────────────────────────────────

function _randomMove(board) {
  const empty = getEmptyCells(board)
  return empty[Math.floor(Math.random() * empty.length)]
}

function _greedyEngine(model) {
  const engine = new QLearningEngine({ ...model.config, epsilonStart: 0, epsilonMin: 0 })
  engine.loadQTable(model.qtable)
  engine.epsilon = 0
  return engine
}

function _runGames(engine, opponentFn, games = 1000) {
  let wins = 0, losses = 0, draws = 0
  for (let i = 0; i < games; i++) {
    const result = runEpisode(engine, 'X', opponentFn)
    if (result.outcome === 'WIN') wins++
    else if (result.outcome === 'LOSS') losses++
    else draws++
  }
  return { wins, losses, draws, total: games, winRate: parseFloat((wins / games).toFixed(4)) }
}

export async function startBenchmark(modelId) {
  const model = await db.mLModel.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')
  const record = await db.mLBenchmarkResult.create({
    data: { modelId, vsRandom: {}, vsEasy: {}, vsMedium: {}, vsHard: {}, summary: { status: 'RUNNING' } },
  })
  setImmediate(() => _runBenchmark(model, record.id))
  return record
}

export async function getBenchmark(benchmarkId) {
  return db.mLBenchmarkResult.findUnique({ where: { id: benchmarkId } })
}

export async function listBenchmarks(modelId) {
  return db.mLBenchmarkResult.findMany({
    where: { modelId },
    orderBy: { runAt: 'desc' },
  })
}

async function _runBenchmark(model, benchmarkId) {
  try {
    const engine = _greedyEngine(model)
    const GAMES = 1000

    const vsRandom = _runGames(engine, _randomMove, GAMES)
    await new Promise(r => setImmediate(r))
    const vsEasy   = _runGames(engine, (b, p) => minimaxMove(b, 'easy', p), GAMES)
    await new Promise(r => setImmediate(r))
    const vsMedium = _runGames(engine, (b, p) => minimaxMove(b, 'medium', p), GAMES)
    await new Promise(r => setImmediate(r))
    const vsHard   = _runGames(engine, (b, p) => minimaxMove(b, 'hard', p), GAMES)

    // Add p-values
    for (const r of [vsRandom, vsEasy, vsMedium, vsHard]) {
      r.pValue = proportionPValue(r.wins, r.total)
    }

    const summary = {
      status: 'COMPLETED',
      avgWinRate: parseFloat(((vsRandom.winRate + vsEasy.winRate + vsMedium.winRate + vsHard.winRate) / 4).toFixed(4)),
    }

    await db.mLBenchmarkResult.update({
      where: { id: benchmarkId },
      data: { vsRandom, vsEasy, vsMedium, vsHard, summary },
    })

    _emit(`ml:benchmark:${benchmarkId}`, 'ml:benchmark_complete', { benchmarkId, modelId: model.id, summary })
    logger.info({ benchmarkId, modelId: model.id }, 'Benchmark completed')
  } catch (err) {
    logger.error({ err, benchmarkId }, 'Benchmark failed')
    await db.mLBenchmarkResult.update({ where: { id: benchmarkId }, data: { summary: { status: 'FAILED', error: err.message } } })
  }
}

// ─── Head-to-head ────────────────────────────────────────────────────────────

export async function runVersus(modelAId, modelBId, games = 100) {
  if (games < 1 || games > 1000) throw new Error('games must be 1–1000')
  const [modelA, modelB] = await Promise.all([
    db.mLModel.findUnique({ where: { id: modelAId } }),
    db.mLModel.findUnique({ where: { id: modelBId } }),
  ])
  if (!modelA || !modelB) throw new Error('Model not found')

  const engineA = _greedyEngine(modelA)
  const engineB = _greedyEngine(modelB)

  let winsA = 0, winsB = 0, draws = 0

  for (let i = 0; i < games; i++) {
    // Alternate who plays X each game
    const aIsX = i % 2 === 0
    const mlMark = 'X'
    const [attacker, defender] = aIsX ? [engineA, engineB] : [engineB, engineA]

    // Play out the game using attacker as ML and defender as opponent
    const opponentFn = (board) => defender.chooseAction(board, false)
    const result = runEpisode(attacker, mlMark, opponentFn)

    if (result.outcome === 'WIN')       { if (aIsX) winsA++; else winsB++ }
    else if (result.outcome === 'LOSS') { if (aIsX) winsB++; else winsA++ }
    else draws++
  }

  const winRateA = parseFloat((winsA / games).toFixed(4))
  const pValue = twoProportionPValue(winsA, games, winsB, games)

  // Update ELO based on aggregate result
  const outcome = winsA > winsB ? 'WIN' : winsA < winsB ? 'LOSS' : 'DRAW'
  await updateElo(modelAId, modelBId, outcome)

  return { modelAId, modelBId, games, winsA, winsB, draws, winRateA, pValue }
}

// ─── Tournament ───────────────────────────────────────────────────────────────

export async function startTournament({ modelIds, gamesPerPair = 50 }) {
  if (!Array.isArray(modelIds) || modelIds.length < 2) throw new Error('Need at least 2 model IDs')
  const tournament = await db.mLTournament.create({
    data: { modelIds, gamesPerPair, status: 'RUNNING' },
  })
  setImmediate(() => _runTournament(tournament.id, modelIds, gamesPerPair))
  return tournament
}

export async function getTournament(id) {
  return db.mLTournament.findUnique({ where: { id } })
}

export async function listTournaments() {
  return db.mLTournament.findMany({ orderBy: { createdAt: 'desc' }, take: 10 })
}

async function _runTournament(tournamentId, modelIds, gamesPerPair) {
  try {
    const models = await Promise.all(modelIds.map(id => db.mLModel.findUnique({ where: { id } })))
    const valid = models.filter(Boolean)
    const engines = Object.fromEntries(valid.map(m => [m.id, _greedyEngine(m)]))

    const pairResults = {}
    const standings = Object.fromEntries(valid.map(m => [m.id, { modelId: m.id, name: m.name, wins: 0, losses: 0, draws: 0, points: 0 }]))

    // All pairwise matchups
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i]
        const b = valid[j]
        let wA = 0, wB = 0, d = 0
        for (let k = 0; k < gamesPerPair; k++) {
          const aIsX = k % 2 === 0
          const [attacker, defender] = aIsX ? [engines[a.id], engines[b.id]] : [engines[b.id], engines[a.id]]
          const result = runEpisode(attacker, 'X', board => defender.chooseAction(board, false))
          if (result.outcome === 'WIN')       { if (aIsX) wA++; else wB++ }
          else if (result.outcome === 'LOSS') { if (aIsX) wB++; else wA++ }
          else d++
        }
        pairResults[`${a.id}:${b.id}`] = { wA, wB, d, games: gamesPerPair }
        standings[a.id].wins += wA; standings[a.id].losses += wB; standings[a.id].draws += d
        standings[b.id].wins += wB; standings[b.id].losses += wA; standings[b.id].draws += d
        standings[a.id].points += wA + d * 0.5
        standings[b.id].points += wB + d * 0.5

        // ELO update
        const outcome = wA > wB ? 'WIN' : wA < wB ? 'LOSS' : 'DRAW'
        await updateElo(a.id, b.id, outcome)
        await new Promise(r => setImmediate(r))
      }
    }

    const ranked = Object.values(standings).sort((a, b) => b.points - a.points)
    const results = { standings: ranked, pairResults }

    await db.mLTournament.update({
      where: { id: tournamentId },
      data: { status: 'COMPLETED', results, completedAt: new Date() },
    })
    _emit('ml:tournament', 'ml:tournament_complete', { tournamentId, standings: ranked })
    logger.info({ tournamentId }, 'Tournament completed')
  } catch (err) {
    logger.error({ err, tournamentId }, 'Tournament failed')
    await db.mLTournament.update({ where: { id: tournamentId }, data: { status: 'FAILED' } })
  }
}

export async function saveCheckpoint(modelId) {
  const model = await db.mLModel.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')
  return db.mLCheckpoint.create({
    data: {
      modelId,
      episodeNum: model.totalEpisodes,
      qtable: model.qtable,
      epsilon: model.config?.currentEpsilon ?? model.config?.epsilonStart ?? 1.0,
      eloRating: model.eloRating,
    },
  })
}

export async function getCheckpoint(modelId, checkpointId) {
  const cp = await db.mLCheckpoint.findUnique({ where: { id: checkpointId } })
  if (!cp || cp.modelId !== modelId) throw new Error('Checkpoint not found')
  return cp
}

export async function exportModel(modelId) {
  const model = await db.mLModel.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')
  // eslint-disable-next-line no-unused-vars
  const { id, createdAt, updatedAt, ...rest } = model
  return rest
}

export async function importModel(data) {
  const { name, description, algorithm, config, qtable, totalEpisodes, eloRating } = data
  if (!name?.trim()) throw new Error('name is required')
  const mergedConfig = { ...DEFAULT_CONFIG, ...(config || {}) }
  return db.mLModel.create({
    data: {
      name: name.trim(),
      description: description || null,
      algorithm: algorithm || 'Q_LEARNING',
      config: mergedConfig,
      qtable: qtable || {},
      totalEpisodes: totalEpisodes || 0,
      eloRating: eloRating || 1000,
    },
  })
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

  // Forgetting detection: compare vsHard win rate with previous benchmark
  try {
    const lastBenchmarks = await db.mLBenchmarkResult.findMany({
      where: { modelId, summary: { path: ['status'], equals: 'COMPLETED' } },
      orderBy: { runAt: 'desc' },
      take: 1,
    })
    if (lastBenchmarks.length > 0) {
      const prev = lastBenchmarks[0]
      const prevHardRate = prev.vsHard?.winRate ?? null
      if (prevHardRate !== null) {
        // Mini-benchmark: 100 games vs hard
        const freshModel = await db.mLModel.findUnique({ where: { id: modelId } })
        const greedyEng = _greedyEngine(freshModel)
        const miniResult = _runGames(greedyEng, (b, p) => minimaxMove(b, 'hard', p), 100)
        const drop = prevHardRate - miniResult.winRate
        if (drop > 0.05) {
          _emit(`ml:model:${modelId}`, 'ml:regression_detected', {
            modelId, drop: parseFloat(drop.toFixed(4)),
            prevWinRate: prevHardRate, currentWinRate: miniResult.winRate,
          })
          logger.warn({ modelId, drop }, 'Forgetting detected after training')
        }
      }
    }
  } catch (forgettingErr) {
    logger.warn({ forgettingErr }, 'Forgetting detection check failed (non-fatal)')
  }
}

function _emit(room, event, data) {
  if (_io) _io.to(room).emit(event, data)
}
