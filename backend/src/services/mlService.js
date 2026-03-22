/**
 * ML Service — CRUD, training orchestration, in-memory cache.
 *
 * Training runs as a background setImmediate loop, yielding every
 * BATCH_SIZE episodes so the event loop stays responsive. Progress
 * is broadcast via Socket.io to the room `ml:session:{id}`.
 */

import db from '../lib/db.js'
import { QLearningEngine, runEpisode, DEFAULT_CONFIG } from '../ai/qLearning.js'
import { SarsaEngine } from '../ai/sarsa.js'
import { MonteCarloEngine } from '../ai/monteCarlo.js'
import { PolicyGradientEngine } from '../ai/policyGradient.js'
import { DQNEngine } from '../ai/dqn.js'
import { AlphaZeroEngine } from '../ai/alphaZero.js'
import { minimaxMove } from '../ai/minimax.js'
import { getWinner, isBoardFull, getEmptyCells, opponent } from '../ai/gameLogic.js'
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

// ─── Training queue ──────────────────────────────────────────────────────────
/** Queue of pending training requests: [{ modelId, sessionId, opts }, ...] */
const trainingQueue = []

// ─── Model CRUD ─────────────────────────────────────────────────────────────

export async function listModels() {
  const models = await db.mLModel.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sessions: true } } },
  })

  // Enrich with creator display names in one extra query
  const creatorIds = [...new Set(models.map(m => m.createdBy).filter(Boolean))]
  const creators = creatorIds.length
    ? await db.user.findMany({
        where: { betterAuthId: { in: creatorIds } },
        select: { betterAuthId: true, displayName: true, username: true },
      })
    : []
  const creatorMap = Object.fromEntries(creators.map(u => [u.betterAuthId, u]))

  const enriched = models.map(m => ({
    ...m,
    creatorName: m.createdBy
      ? (creatorMap[m.createdBy]?.displayName || creatorMap[m.createdBy]?.username || null)
      : null,
  }))

  // Featured models always appear first
  return [...enriched.filter(m => m.featured), ...enriched.filter(m => !m.featured)]
}

// ─── System config ────────────────────────────────────────────────────────────

export async function getSystemConfig(key, defaultValue = null) {
  const row = await db.systemConfig.findUnique({ where: { key } })
  return row ? row.value : defaultValue
}

export async function setSystemConfig(key, value) {
  return db.systemConfig.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function createModel({ name, description, algorithm = 'Q_LEARNING', config = {}, createdBy = null }) {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config }

  // For DQN: resolve and validate the neural network shape, then bake layerSizes in.
  if (algorithm === 'DQN') {
    const [defaultHidden, maxLayers, maxUnits] = await Promise.all([
      getSystemConfig('ml.dqn.defaultHiddenLayers', [32]),
      getSystemConfig('ml.dqn.maxHiddenLayers', 3),
      getSystemConfig('ml.dqn.maxUnitsPerLayer', 256),
    ])
    const networkShape = config.networkShape ?? defaultHidden
    if (!Array.isArray(networkShape) || networkShape.length === 0) {
      throw Object.assign(new Error('networkShape must be a non-empty array of layer sizes'), { status: 400 })
    }
    if (networkShape.length > maxLayers) {
      throw Object.assign(new Error(`networkShape exceeds the maximum of ${maxLayers} hidden layers`), { status: 400 })
    }
    for (const units of networkShape) {
      const n = parseInt(units)
      if (isNaN(n) || n < 1 || n > maxUnits) {
        throw Object.assign(new Error(`Each hidden layer must be between 1 and ${maxUnits} units`), { status: 400 })
      }
    }
    mergedConfig.layerSizes   = [9, ...networkShape.map(Number), 9]
    mergedConfig.networkShape = networkShape.map(Number)
    delete mergedConfig.hiddenSize  // layerSizes takes precedence
  }

  const maxEpisodes = await getSystemConfig('ml.maxEpisodesPerModel', 100_000)
  return db.mLModel.create({
    data: { name, description: description || null, algorithm, qtable: {}, config: mergedConfig, createdBy, maxEpisodes },
  })
}

export async function getModel(id) {
  const model = await db.mLModel.findUnique({
    where: { id },
    include: { _count: { select: { sessions: true, checkpoints: true, benchmarks: true } } },
  })
  if (!model) return null
  const creator = model.createdBy
    ? await db.user.findUnique({
        where: { betterAuthId: model.createdBy },
        select: { displayName: true, username: true },
      })
    : null
  return {
    ...model,
    creatorName: creator?.displayName || creator?.username || null,
  }
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

export async function cloneModel(id, { name, description, createdBy = null }) {
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
      maxEpisodes: src.maxEpisodes,
      eloRating: src.eloRating,
      createdBy,
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

/**
 * Get a move for an ML model, adapted to a player's observed patterns if profile exists.
 * Falls back to standard exploitation move if no profile or adaptation fails.
 *
 * @param {string} modelId
 * @param {Array}  board
 * @param {string} mark   - AI mark ('X' or 'O')
 * @param {string} userId - Clerk user ID for profile lookup
 * @returns {Promise<number>} chosen cell index
 */
export async function getAdaptedMoveForModel(modelId, board, mark, userId) {
  // Ensure engine is loaded
  if (!engineCache.has(modelId)) {
    const model = await db.mLModel.findUnique({ where: { id: modelId } })
    if (!model) throw new Error(`ML model ${modelId} not found`)
    const engine = new QLearningEngine(model.config)
    engine.loadQTable(model.qtable)
    engineCache.set(modelId, engine)
  }
  const engine = engineCache.get(modelId)

  const profile = await getPlayerProfile(modelId, userId).catch(() => null)
  if (profile) {
    return adaptedChooseAction(engine, board, mark, profile)
  }
  return engine.chooseAction(board, false)
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
    data: { modelId, vsRandom: {}, vsEasy: {}, vsMedium: {}, vsTough: {}, vsHard: {}, summary: { status: 'RUNNING' } },
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
    const vsEasy   = _runGames(engine, (b, p) => minimaxMove(b, 'novice', p), GAMES)
    await new Promise(r => setImmediate(r))
    const vsMedium = _runGames(engine, (b, p) => minimaxMove(b, 'intermediate', p), GAMES)
    await new Promise(r => setImmediate(r))
    const vsTough  = _runGames(engine, (b, p) => minimaxMove(b, 'advanced', p), GAMES)
    await new Promise(r => setImmediate(r))
    const vsHard   = _runGames(engine, (b, p) => minimaxMove(b, 'master', p), GAMES)

    // Add p-values
    for (const r of [vsRandom, vsEasy, vsMedium, vsTough, vsHard]) {
      r.pValue = proportionPValue(r.wins, r.total)
    }

    const summary = {
      status: 'COMPLETED',
      avgWinRate: parseFloat(((vsRandom.winRate + vsEasy.winRate + vsMedium.winRate + vsTough.winRate + vsHard.winRate) / 5).toFixed(4)),
    }

    await db.mLBenchmarkResult.update({
      where: { id: benchmarkId },
      data: { vsRandom, vsEasy, vsMedium, vsTough, vsHard, summary },
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
  const { name, description, algorithm, config, qtable, totalEpisodes, eloRating, createdBy = null } = data
  if (!name?.trim()) throw new Error('name is required')
  const mergedConfig = { ...DEFAULT_CONFIG, ...(config || {}) }
  const maxEpisodes = await getSystemConfig('ml.maxEpisodesPerModel', 100_000)
  return db.mLModel.create({
    data: {
      name: name.trim(),
      description: description || null,
      algorithm: algorithm || 'Q_LEARNING',
      config: mergedConfig,
      qtable: qtable || {},
      totalEpisodes: totalEpisodes || 0,
      maxEpisodes,
      eloRating: eloRating || 1000,
      createdBy,
    },
  })
}

// ─── Training ────────────────────────────────────────────────────────────────

export async function startTraining(modelId, { mode, iterations, config = {} }) {
  const model = await getModel(modelId)
  if (!model) throw new Error('Model not found')
  if (iterations < 1 || iterations > 100_000) throw new Error('iterations must be 1–100,000')

  // Enforce admin-configurable limits
  const [maxEpisodes, maxConcurrent] = await Promise.all([
    getSystemConfig('ml.maxEpisodesPerSession', 100_000),
    getSystemConfig('ml.maxConcurrentSessions', 0), // 0 = unlimited
  ])
  if (maxEpisodes > 0 && iterations > maxEpisodes) {
    throw new Error(`Training limit: max ${maxEpisodes.toLocaleString()} episodes per session`)
  }
  if (maxConcurrent > 0) {
    const runningCount = await db.mLModel.count({ where: { status: 'TRAINING' } })
    if (runningCount >= maxConcurrent) {
      throw new Error(`Training limit: max ${maxConcurrent} concurrent session${maxConcurrent !== 1 ? 's' : ''}`)
    }
  }

  // Enforce per-model lifetime episode cap
  if (model.maxEpisodes > 0) {
    const remaining = model.maxEpisodes - model.totalEpisodes
    if (remaining <= 0) {
      throw new Error(`Training limit: this model has reached its ${model.maxEpisodes.toLocaleString()} episode maximum`)
    }
    if (iterations > remaining) {
      throw new Error(`Training limit: only ${remaining.toLocaleString()} episodes remain (limit: ${model.maxEpisodes.toLocaleString()}, used: ${model.totalEpisodes.toLocaleString()})`)
    }
  }

  if (model.status === 'TRAINING') {
    // Queue the session instead of throwing 409
    const session = await db.trainingSession.create({
      data: { modelId, mode, iterations, status: 'PENDING', config },
    })
    trainingQueue.push({ modelId, sessionId: session.id, opts: { mode, iterations, config } })
    logger.info({ modelId, sessionId: session.id }, 'Training queued')
    return session
  }

  const session = await db.trainingSession.create({
    data: { modelId, mode, iterations, status: 'RUNNING', config },
  })
  await db.mLModel.update({ where: { id: modelId }, data: { status: 'TRAINING' } })

  // Fire-and-forget background loop
  setImmediate(() => _runTraining(model, session, { mode, iterations, config }))
  return session
}

/** Process the next session in the queue, if any. */
async function _processNextInQueue() {
  if (trainingQueue.length === 0) return
  const next = trainingQueue.shift()
  try {
    const model = await getModel(next.modelId)
    if (!model) return  // model deleted while queued
    if (model.status === 'TRAINING') {
      // Another training snuck in — re-queue
      trainingQueue.unshift(next)
      return
    }
    // Upgrade session from PENDING → RUNNING
    const session = await db.trainingSession.update({
      where: { id: next.sessionId },
      data: { status: 'RUNNING', startedAt: new Date() },
    })
    await db.mLModel.update({ where: { id: next.modelId }, data: { status: 'TRAINING' } })
    setImmediate(() => _runTraining(model, session, next.opts))
    logger.info({ modelId: next.modelId, sessionId: next.sessionId }, 'Queued training started')
  } catch (err) {
    logger.error({ err, next }, 'Failed to start queued training session')
  }
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

/** Instantiate the correct engine based on algorithm name. */
function _buildEngine(modelConfig, algorithm) {
  const alg = (algorithm || 'Q_LEARNING').toUpperCase()
  if (alg === 'SARSA') return new SarsaEngine(modelConfig)
  if (alg === 'MONTE_CARLO' || alg === 'MC') return new MonteCarloEngine(modelConfig)
  if (alg === 'POLICY_GRADIENT' || alg === 'PG') return new PolicyGradientEngine(modelConfig)
  if (alg === 'DQN') return new DQNEngine(modelConfig)
  if (alg === 'ALPHA_ZERO' || alg === 'AZ') return new AlphaZeroEngine(modelConfig)
  return new QLearningEngine(modelConfig)
}

/**
 * Run a single DQN episode.
 * After each move: pushExperience + trainStep.
 * At end: decayEpsilon.
 */
function _runDQNEpisode(engine, opponentFn, mlMark) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0

  while (true) {
    const isML = mlMark === 'both' || currentPlayer === mlMark
    const prevBoard = [...board]
    const action = isML
      ? engine.chooseAction(board, currentPlayer, true)
      : opponentFn(board, currentPlayer)

    board[action] = currentPlayer
    totalMoves++

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)
    const done = !!(winner || isDraw)

    let reward = 0
    if (done) {
      if (winner) {
        reward = winner === (mlMark === 'both' ? currentPlayer : mlMark) ? 1.0 : -1.0
      } else {
        reward = 0.5  // draw
      }
    }

    if (isML) {
      const encodedPrev = _encodeStateForDQN(prevBoard, currentPlayer)
      const encodedNext = _encodeStateForDQN(board, opponent(currentPlayer))
      engine.pushExperience(encodedPrev, action, reward, encodedNext, done)
      engine.trainStep()
    }

    if (done) {
      engine.decayEpsilon()
      let outcome
      if (isDraw) {
        outcome = 'DRAW'
      } else if (mlMark === 'both') {
        outcome = winner === 'X' ? 'WIN' : 'LOSS'
      } else {
        outcome = winner === mlMark ? 'WIN' : 'LOSS'
      }
      return { outcome, totalMoves, avgQDelta: 0, epsilon: engine.epsilon }
    }

    currentPlayer = opponent(currentPlayer)
  }
}

function _encodeStateForDQN(board, mark) {
  const opp = mark === 'X' ? 'O' : 'X'
  return board.map(c => c === mark ? 1 : c === opp ? -1 : 0)
}

/**
 * Run a single AlphaZero episode (delegates to engine self-play).
 */
function _runAlphaZeroEpisode(engine) {
  const result = engine.runEpisode()
  return { outcome: result.outcome || 'DRAW', totalMoves: result.totalMoves || 9, avgQDelta: 0, epsilon: 0 }
}

/**
 * Run a single SARSA episode.
 * SARSA requires the *actual* next action, not max, so we need a custom loop.
 */
function _runSarsaEpisode(engine, mlMark, opponentFn) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0
  let totalQDelta = 0
  let qdeltaCount = 0
  const history = { X: [], O: [] }

  // Pre-select first action for ML player if applicable
  function mlChoose(b) { return engine.chooseAction(b, true) }

  while (true) {
    const isML = mlMark === 'both' || currentPlayer === mlMark
    const action = isML ? mlChoose(board) : opponentFn(board, currentPlayer)

    const prevBoard = [...board]
    board[action] = currentPlayer
    totalMoves++
    history[currentPlayer].push({ board: prevBoard, action })

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const rewards = winner === 'X'
        ? { X: 1.0, O: -1.0 }
        : winner === 'O'
          ? { X: -1.0, O: 1.0 }
          : { X: 0.5, O: 0.5 }

      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]
      for (const mark of marksToUpdate) {
        const steps = history[mark]
        for (let t = 0; t < steps.length; t++) {
          const { board: s, action: a } = steps[t]
          const isLast = t === steps.length - 1
          // nextAction is the next step's action (or -1 at terminal)
          const nextAction = isLast ? -1 : steps[t + 1].action
          const nextBoard  = isLast ? board : steps[t + 1].board
          const delta = engine.update(s, a, isLast ? rewards[mark] : 0, nextBoard, nextAction, isLast)
          totalQDelta += delta
          qdeltaCount++
        }
      }
      engine.decayEpsilon()

      let outcome
      if (isDraw) outcome = 'DRAW'
      else if (mlMark === 'both') outcome = winner === 'X' ? 'WIN' : 'LOSS'
      else outcome = winner === mlMark ? 'WIN' : 'LOSS'

      return { outcome, totalMoves, avgQDelta: qdeltaCount > 0 ? totalQDelta / qdeltaCount : 0, epsilon: engine.epsilon }
    }

    currentPlayer = opponent(currentPlayer)
  }
}

/**
 * Run a single Monte Carlo episode.
 */
function _runMCEpisode(engine, mlMark, opponentFn) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0

  // Reset trajectory for each player
  const trajectories = { X: [], O: [] }

  while (true) {
    const isML = mlMark === 'both' || currentPlayer === mlMark
    const prevBoard = [...board]

    let action
    if (isML) {
      action = engine.chooseAction(board, true)
      trajectories[currentPlayer].push({ board: prevBoard, action })
    } else {
      action = opponentFn(board, currentPlayer)
    }

    board[action] = currentPlayer
    totalMoves++

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const rewards = winner === 'X'
        ? { X: 1.0, O: -1.0 }
        : winner === 'O'
          ? { X: -1.0, O: 1.0 }
          : { X: 0.5, O: 0.5 }

      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]
      let totalDelta = 0
      let count = 0

      for (const mark of marksToUpdate) {
        // Feed trajectory into engine
        engine._trajectory = trajectories[mark]
        const delta = engine.finishEpisode(rewards[mark])
        totalDelta += delta
        count++
      }
      engine.decayEpsilon()

      let outcome
      if (isDraw) outcome = 'DRAW'
      else if (mlMark === 'both') outcome = winner === 'X' ? 'WIN' : 'LOSS'
      else outcome = winner === mlMark ? 'WIN' : 'LOSS'

      return { outcome, totalMoves, avgQDelta: count > 0 ? totalDelta / count : 0, epsilon: engine.epsilon }
    }

    currentPlayer = opponent(currentPlayer)
  }
}

/**
 * Run a single Policy Gradient episode.
 */
function _runPGEpisode(engine, mlMark, opponentFn) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0

  const trajectories = { X: [], O: [] }

  while (true) {
    const isML = mlMark === 'both' || currentPlayer === mlMark
    const prevBoard = [...board]

    let action
    if (isML) {
      action = engine.chooseAction(board, true)
      trajectories[currentPlayer].push({ board: prevBoard, action, logProb: 0 })
    } else {
      action = opponentFn(board, currentPlayer)
    }

    board[action] = currentPlayer
    totalMoves++

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const rewards = winner === 'X'
        ? { X: 1.0, O: -1.0 }
        : winner === 'O'
          ? { X: -1.0, O: 1.0 }
          : { X: 0.5, O: 0.5 }

      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]
      let totalDelta = 0
      let count = 0

      for (const mark of marksToUpdate) {
        engine._trajectory = trajectories[mark]
        const delta = engine.finishEpisode(rewards[mark])
        totalDelta += delta
        count++
      }
      engine.decayEpsilon()

      let outcome
      if (isDraw) outcome = 'DRAW'
      else if (mlMark === 'both') outcome = winner === 'X' ? 'WIN' : 'LOSS'
      else outcome = winner === mlMark ? 'WIN' : 'LOSS'

      return { outcome, totalMoves, avgQDelta: count > 0 ? totalDelta / count : 0, epsilon: engine.epsilon }
    }

    currentPlayer = opponent(currentPlayer)
  }
}

/** Run one episode using whatever engine/algorithm is active. */
function _runEpisodeForAlgorithm(engine, mlMark, opponentFn, algorithm) {
  const alg = (algorithm || 'Q_LEARNING').toUpperCase()
  if (alg === 'SARSA') return _runSarsaEpisode(engine, mlMark, opponentFn)
  if (alg === 'MONTE_CARLO' || alg === 'MC') return _runMCEpisode(engine, mlMark, opponentFn)
  if (alg === 'POLICY_GRADIENT' || alg === 'PG') return _runPGEpisode(engine, mlMark, opponentFn)
  if (alg === 'DQN') return _runDQNEpisode(engine, opponentFn, mlMark)
  if (alg === 'ALPHA_ZERO' || alg === 'AZ') return _runAlphaZeroEpisode(engine)
  return runEpisode(engine, mlMark, opponentFn)
}

const CURRICULUM_LEVELS = ['novice', 'intermediate', 'advanced', 'master']

async function _runTraining(model, session, { mode, iterations, config }) {
  const { id: sessionId, modelId } = { id: session.id, modelId: model.id }

  // Determine algorithm from config or model
  const algorithm = config.algorithm || model.algorithm || 'Q_LEARNING'

  // Build engine from current model state, merging per-session overrides
  // (epsilonDecay, epsilonMin, decayMethod, batchSize, etc. from the UI) into the stored model config.
  // Include totalEpisodes so linear/cosine schedules know the full run length.
  const sessionEngineConfig = { ...model.config, ...config, totalEpisodes: iterations }
  const engine = _buildEngine(sessionEngineConfig, algorithm)
  engine.loadQTable(model.qtable)

  // Build opponent function
  let difficulty = config.difficulty || 'novice'
  // curriculumLevel must start at the selected difficulty so advances go forward correctly
  let curriculumLevel = Math.max(0, CURRICULUM_LEVELS.indexOf(difficulty))
  const opponentFn = mode === 'VS_MINIMAX'
    ? (board, player) => minimaxMove(board, difficulty, player)
    : null
  const mlMarkConfig = mode === 'SELF_PLAY' ? 'both' : (config.mlMark || 'alternating')
  // For alternating, we flip each episode; otherwise it's fixed
  let mlMark = mlMarkConfig === 'alternating' ? 'X' : mlMarkConfig

  // Early stopping config
  const earlyStop = config.earlyStop || null
  let bestWinRate = 0
  let episodesWithoutImprovement = 0

  // Curriculum: rolling window of last 100 outcomes
  const CURRICULUM_WINDOW = 100
  const outcomeWindow = []  // recent outcomes for curriculum

  const PROGRESS_INTERVAL = Math.max(BATCH_SIZE, Math.floor(iterations / 20))
  const episodeBatch = []
  let wins = 0, losses = 0, draws = 0, totalQDelta = 0, totalDurationMs = 0
  let actualEpisodes = 0

  try {
    for (let i = 0; i < iterations; i++) {
      // Cooperative cancellation check
      if (cancelledSessions.has(sessionId)) {
        cancelledSessions.delete(sessionId)
        await _finishSession(sessionId, modelId, engine, actualEpisodes, 'CANCELLED', { wins, losses, draws, totalQDelta })
        return
      }

      const t0 = Date.now()
      const result = _runEpisodeForAlgorithm(engine, mlMark, opponentFn, algorithm)
      const durationMs = Date.now() - t0
      actualEpisodes++
      if (mlMarkConfig === 'alternating') mlMark = mlMark === 'X' ? 'O' : 'X'

      if (result.outcome === 'WIN')       wins++
      else if (result.outcome === 'LOSS') losses++
      else                                draws++
      totalQDelta += result.avgQDelta
      totalDurationMs += durationMs

      episodeBatch.push({
        sessionId, episodeNum: i + 1,
        outcome: result.outcome, totalMoves: result.totalMoves,
        avgQDelta: result.avgQDelta, epsilon: result.epsilon, durationMs,
      })

      // ── Curriculum learning ─────────────────────────────────────────────
      if (config.curriculum && mode === 'VS_MINIMAX') {
        outcomeWindow.push(result.outcome === 'WIN' ? 1 : 0)
        if (outcomeWindow.length > CURRICULUM_WINDOW) outcomeWindow.shift()

        if (outcomeWindow.length === CURRICULUM_WINDOW) {
          const windowWinRate = outcomeWindow.reduce((s, v) => s + v, 0) / CURRICULUM_WINDOW
          if (windowWinRate > 0.65 && curriculumLevel < CURRICULUM_LEVELS.length - 1) {
            curriculumLevel++
            difficulty = CURRICULUM_LEVELS[curriculumLevel]
            outcomeWindow.length = 0  // reset window
            _emit(`ml:session:${sessionId}`, 'ml:curriculum_advance', {
              sessionId, level: curriculumLevel, difficulty, episode: i + 1,
            })
            logger.info({ sessionId, difficulty }, 'Curriculum advanced')
          }
        }
      }

      // ── Early stopping ───────────────────────────────────────────────────
      if (earlyStop && (i + 1) % PROGRESS_INTERVAL === 0) {
        const currentWinRate = wins / (i + 1)
        if (currentWinRate > bestWinRate + (earlyStop.minDelta ?? 0.01)) {
          bestWinRate = currentWinRate
          episodesWithoutImprovement = 0
        } else {
          episodesWithoutImprovement += PROGRESS_INTERVAL
        }
        if (episodesWithoutImprovement >= (earlyStop.patience ?? 200)) {
          // Flush batch
          if (episodeBatch.length > 0) {
            await db.trainingEpisode.createMany({ data: episodeBatch })
            episodeBatch.length = 0
          }
          _emit(`ml:session:${sessionId}`, 'ml:early_stop', { sessionId, episode: i + 1, bestWinRate })
          logger.info({ sessionId, episode: i + 1, bestWinRate }, 'Early stopping triggered')
          await _finishSession(sessionId, modelId, engine, actualEpisodes, 'COMPLETED', { wins, losses, draws, totalQDelta }, { earlyStop: true, stoppedAt: i + 1 })
          return
        }
      }

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
          avgGameMs: done > 0 ? totalDurationMs / done : 0,
          epsilon: engine.epsilon,
          outcomes: { wins, losses, draws },
        })
        await new Promise(r => setImmediate(r))
      }
    }

    await _finishSession(sessionId, modelId, engine, actualEpisodes, 'COMPLETED', { wins, losses, draws, totalQDelta })
  } catch (err) {
    logger.error({ err, sessionId, modelId }, 'Training failed')
    await db.mLModel.update({ where: { id: modelId }, data: { status: 'IDLE' } })
    await db.trainingSession.update({ where: { id: sessionId }, data: { status: 'FAILED', completedAt: new Date() } })
    _emit(`ml:session:${sessionId}`, 'ml:error', { sessionId, error: err.message })
    _processNextInQueue()
  }
}

async function _finishSession(sessionId, modelId, engine, iterations, status, { wins, losses, draws, totalQDelta }, extraMeta = {}) {
  const summary = {
    wins, losses, draws,
    winRate:    iterations > 0 ? wins / iterations : 0,
    avgQDelta:  iterations > 0 ? totalQDelta / iterations : 0,
    finalEpsilon: engine.epsilon,
    stateCount: engine.stateCount,
    ...extraMeta,
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

  // Start next queued session if any
  _processNextInQueue()

  // ELO calibration: play 100 games vs each fixed minimax level and update ELO
  try {
    const calibModel  = await db.mLModel.findUnique({ where: { id: modelId }, select: { eloRating: true } })
    const calibEngine = _greedyEngine(await db.mLModel.findUnique({ where: { id: modelId } }))
    const CALIBRATION_OPPONENTS = [
      { difficulty: 'novice',       fixedElo: 800  },
      { difficulty: 'intermediate', fixedElo: 1200 },
      { difficulty: 'advanced',     fixedElo: 1500 },
      { difficulty: 'master',       fixedElo: 1800 },
    ]
    const CALIB_GAMES = 100
    let currentElo = calibModel.eloRating
    for (const { difficulty, fixedElo } of CALIBRATION_OPPONENTS) {
      const r = _runGames(calibEngine, (b, p) => minimaxMove(b, difficulty, p), CALIB_GAMES)
      const actual   = (r.wins + r.draws * 0.5) / CALIB_GAMES
      const expected = _expectedScore(currentElo, fixedElo)
      currentElo = parseFloat((currentElo + ELO_K * (actual - expected)).toFixed(2))
      await new Promise(res => setImmediate(res))
    }
    const delta = parseFloat((currentElo - calibModel.eloRating).toFixed(2))
    const outcome = delta > 0 ? 'WIN' : delta < 0 ? 'LOSS' : 'DRAW'
    await db.mLModel.update({ where: { id: modelId }, data: { eloRating: currentElo } })
    await db.mLEloHistory.create({ data: { modelId, eloRating: currentElo, delta, opponentType: 'MINIMAX', outcome } })
    logger.info({ modelId, newElo: currentElo, delta }, 'ELO calibrated after training')
  } catch (eloErr) {
    logger.warn({ eloErr }, 'ELO calibration after training failed (non-fatal)')
  }

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
        const miniResult = _runGames(greedyEng, (b, p) => minimaxMove(b, 'master', p), 100)
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

// ─── Hyperparameter Search ────────────────────────────────────────────────────

/**
 * Run a grid search over hyperparameter combinations.
 *
 * @param {string} modelId
 * @param {{ paramGrid: Object, gamesPerConfig: number }} opts
 * @returns {{ bestConfig: Object, results: Array }} best config and all results
 */
export async function startHyperparamSearch(modelId, { paramGrid = {}, gamesPerConfig = 500 } = {}) {
  const model = await db.mLModel.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')

  // Build cartesian product of paramGrid
  const keys   = Object.keys(paramGrid)
  const values = keys.map(k => paramGrid[k])

  function* cartesian(arrays, current = []) {
    if (current.length === arrays.length) { yield [...current]; return }
    for (const v of arrays[current.length]) {
      current.push(v)
      yield* cartesian(arrays, current)
      current.pop()
    }
  }

  const configs = keys.length > 0
    ? [...cartesian(values)].map(combo => Object.fromEntries(keys.map((k, i) => [k, combo[i]])))
    : [{}]

  const BENCH_GAMES = 50
  const opponentFn  = (board, player) => minimaxMove(board, 'master', player)
  const results     = []

  for (const cfg of configs) {
    const mergedConfig = { ...DEFAULT_CONFIG, ...model.config, ...cfg, currentEpsilon: cfg.epsilonStart ?? DEFAULT_CONFIG.epsilonStart }
    const engine = new QLearningEngine(mergedConfig)
    // Load current qtable as starting point
    engine.loadQTable(model.qtable && typeof model.qtable === 'object' ? { ...model.qtable } : {})

    // Train for gamesPerConfig episodes vs VS_MINIMAX hard
    for (let i = 0; i < gamesPerConfig; i++) {
      runEpisode(engine, 'X', opponentFn)
    }

    // Evaluate: 50 exploitation games vs hard
    const greedyEng = new QLearningEngine({ ...mergedConfig, currentEpsilon: 0, epsilonMin: 0 })
    greedyEng.loadQTable(engine.toJSON())
    greedyEng.epsilon = 0
    let benchWins = 0
    for (let i = 0; i < BENCH_GAMES; i++) {
      const res = runEpisode(greedyEng, 'X', opponentFn)
      if (res.outcome === 'WIN') benchWins++
    }

    const winRate = benchWins / BENCH_GAMES
    results.push({ config: cfg, winRate, wins: benchWins, total: BENCH_GAMES })
  }

  // Sort best first
  results.sort((a, b) => b.winRate - a.winRate)
  const bestConfig = results[0]?.config ?? {}

  // Save best config + all results to model metadata
  const currentMetadata = (model.config && typeof model.config === 'object') ? model.config : {}
  await db.mLModel.update({
    where: { id: modelId },
    data: {
      config: {
        ...currentMetadata,
        ...bestConfig,
        hyperSearchResults: results,
        hyperSearchAt: new Date().toISOString(),
      },
    },
  })

  logger.info({ modelId, configsSearched: configs.length, bestConfig, bestWinRate: results[0]?.winRate }, 'Hyperparam search complete')
  return { bestConfig, results }
}

// ─── Explainability — network activations ────────────────────────────────────

/**
 * Run a forward pass through the engine and return layer activations + Q-values.
 * For tabular engines, returns null activations and uses explainBoard.
 */
export async function explainActivations(modelId, board) {
  const model = await db.mLModel.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')

  const alg = (model.algorithm || 'Q_LEARNING').toUpperCase()

  if (alg === 'DQN') {
    const engine = new DQNEngine(model.config)
    engine.loadQTable(model.qtable)
    const mark = 'X'
    const { qValues, activations } = engine.explainBoard(board, mark)
    return { activations, qValues }
  }

  if (alg === 'ALPHA_ZERO' || alg === 'AZ') {
    const engine = new AlphaZeroEngine(model.config)
    engine.loadQTable(model.qtable)
    const mark = 'X'
    const { qValues, activations, value } = engine.explainBoard(board, mark)
    return { activations, qValues, value }
  }

  // Tabular engine — no network activations
  const engine = _buildEngine(model.config, alg)
  engine.loadQTable(model.qtable)
  const qValues = engine.explainBoard ? engine.explainBoard(board) : null
  return { activations: null, qValues }
}

// ─── Ensemble ─────────────────────────────────────────────────────────────────

/**
 * Get a move recommendation from an ensemble of models.
 * @param {string[]} modelIds
 * @param {'majority'|'weighted'} method
 * @param {number[]|null} weights
 * @param {Array} board
 * @param {string} mark
 */
export async function ensembleMove(modelIds, method, weights, board, mark) {
  const models = await Promise.all(modelIds.map(id => db.mLModel.findUnique({ where: { id } })))
  const valid = models.filter(Boolean)
  if (valid.length === 0) throw new Error('No valid models found')

  const engines = valid.map(m => {
    const alg = (m.algorithm || 'Q_LEARNING').toUpperCase()
    const engine = _buildEngine(m.config, alg)
    engine.loadQTable(m.qtable)
    engine.epsilon = 0
    return { engine, alg, model: m }
  })

  const votes = new Array(9).fill(0)

  if (method === 'weighted' && weights && weights.length === valid.length) {
    // Check if all engines are tabular
    const allTabular = engines.every(({ alg }) => !['DQN', 'ALPHA_ZERO', 'AZ'].includes(alg))

    if (allTabular) {
      // Weight Q-value arrays and argmax
      const weightedQ = new Array(9).fill(0)
      engines.forEach(({ engine, model }, i) => {
        const w = weights[i] ?? 1
        const qvals = engine.explainBoard ? engine.explainBoard(board) : new Array(9).fill(0)
        for (let c = 0; c < 9; c++) {
          if (qvals[c] !== null) weightedQ[c] += w * qvals[c]
        }
      })
      const { getEmptyCells: gec } = await import('../ai/gameLogic.js')
      const empty = gec(board)
      const best = empty.reduce((b, idx) => weightedQ[idx] > weightedQ[b] ? idx : b, empty[0])
      const voteArr = engines.map(({ engine }) => engine.explainBoard ? engine.explainBoard(board) : [])
      const voteActions = engines.map(({ engine }) => {
        const qv = engine.explainBoard ? engine.explainBoard(board) : new Array(9).fill(0)
        return empty.reduce((b, idx) => (qv[idx] ?? -Infinity) > (qv[b] ?? -Infinity) ? idx : b, empty[0])
      })
      return { move: best, votes: voteActions }
    }
    // Mixed/neural engines: fall through to majority
  }

  // Majority vote
  const { getEmptyCells: gec } = await import('../ai/gameLogic.js')
  const empty = gec(board)
  const actions = engines.map(({ engine, alg }) => {
    if (alg === 'DQN') return engine.chooseAction(board, mark, false)
    if (alg === 'ALPHA_ZERO' || alg === 'AZ') return engine.chooseAction(board, mark)
    // Tabular: greedy
    engine.epsilon = 0
    return engine.chooseAction(board, false)
  })

  actions.forEach(a => { if (a >= 0 && a < 9) votes[a]++ })

  // Resolve: best by vote count, ties broken by lowest action index
  const maxVotes = Math.max(...empty.map(i => votes[i]))
  const best = empty.find(i => votes[i] === maxVotes) ?? empty[0]

  return { move: best, votes: actions }
}

function _emit(room, event, data) {
  if (_io) _io.to(room).emit(event, data)
}

// ─── Player Profiling ─────────────────────────────────────────────────────────

/**
 * Record a human move against an ML model. Fire-and-forget — never awaited
 * in the hot path. Errors are caught silently.
 *
 * @param {string} modelId
 * @param {string} userId
 * @param {Array}  board     - board state BEFORE the human's move
 * @param {number} cellIndex - the cell the human played
 */
export function recordHumanMove(modelId, userId, board, cellIndex) {
  // Run async without blocking caller
  ;(async () => {
    try {
      const stateKey = board.join(',')
      const occupiedCount = board.filter(Boolean).length

      // Fetch or create profile
      let profile = await db.mLPlayerProfile.findUnique({
        where: { modelId_userId: { modelId, userId } },
      })
      if (!profile) {
        profile = await db.mLPlayerProfile.create({
          data: { modelId, userId },
        })
      }

      // Update movePatterns
      const movePatterns = profile.movePatterns || {}
      if (!movePatterns[stateKey]) movePatterns[stateKey] = {}
      movePatterns[stateKey][cellIndex] = (movePatterns[stateKey][cellIndex] || 0) + 1

      // Update openingPreferences if it's an early move (0 or 1 cells occupied before this move)
      const openingPreferences = profile.openingPreferences || {}
      if (occupiedCount <= 1) {
        openingPreferences[cellIndex] = (openingPreferences[cellIndex] || 0) + 1
      }

      await db.mLPlayerProfile.update({
        where: { modelId_userId: { modelId, userId } },
        data: { movePatterns, openingPreferences },
      })
    } catch (err) {
      logger.error({ err, modelId, userId }, 'recordHumanMove failed')
    }
  })()
}

/**
 * Recompute player tendencies from movePatterns at game end.
 * Fire-and-forget.
 *
 * @param {string} modelId
 * @param {string} userId
 */
export function updatePlayerTendencies(modelId, userId) {
  ;(async () => {
    try {
      const profile = await db.mLPlayerProfile.findUnique({
        where: { modelId_userId: { modelId, userId } },
      })
      if (!profile) return

      const movePatterns = profile.movePatterns || {}
      const CORNERS = [0, 2, 6, 8]

      let totalMoves = 0
      let centerMoves = 0
      let cornerMoves = 0

      for (const [, cells] of Object.entries(movePatterns)) {
        for (const [cellIdx, count] of Object.entries(cells)) {
          const idx = parseInt(cellIdx, 10)
          const cnt = Number(count)
          totalMoves += cnt
          if (idx === 4) centerMoves += cnt
          if (CORNERS.includes(idx)) cornerMoves += cnt
        }
      }

      const tendencies = {
        centerRate: totalMoves > 0 ? parseFloat((centerMoves / totalMoves).toFixed(4)) : 0,
        cornerRate: totalMoves > 0 ? parseFloat((cornerMoves / totalMoves).toFixed(4)) : 0,
      }

      await db.mLPlayerProfile.update({
        where: { modelId_userId: { modelId, userId } },
        data: {
          tendencies,
          gamesRecorded: { increment: 1 },
        },
      })
    } catch (err) {
      logger.error({ err, modelId, userId }, 'updatePlayerTendencies failed')
    }
  })()
}

/**
 * Return all player profiles for a given model.
 *
 * @param {string} modelId
 */
export async function getPlayerProfiles(modelId) {
  const profiles = await db.mLPlayerProfile.findMany({
    where: { modelId },
    orderBy: { gamesRecorded: 'desc' },
    select: {
      id: true,
      userId: true,
      gamesRecorded: true,
      openingPreferences: true,
      tendencies: true,
      createdAt: true,
    },
  })

  // Enrich with display names in one extra query.
  // userId stored in profiles is the Better Auth ID, so look up by betterAuthId.
  const userIds = [...new Set(profiles.map(p => p.userId))]
  const users = userIds.length
    ? await db.user.findMany({
        where: { betterAuthId: { in: userIds } },
        select: { betterAuthId: true, displayName: true, username: true },
      })
    : []
  const userMap = Object.fromEntries(users.map(u => [u.betterAuthId, u]))

  return profiles.map(p => ({
    ...p,
    displayName: userMap[p.userId]?.displayName ?? null,
    username: userMap[p.userId]?.username ?? null,
  }))
}

/**
 * Return a single player profile for (modelId, userId), or null.
 *
 * @param {string} modelId
 * @param {string} userId
 */
export async function getPlayerProfile(modelId, userId) {
  return db.mLPlayerProfile.findUnique({
    where: { modelId_userId: { modelId, userId } },
  })
}

/**
 * Choose an action adapted to a player's observed move patterns.
 * For tabular engines: bias Q-values toward moves the player tends to make,
 * so the AI can anticipate and counter them.
 * For neural engines: fall through to normal chooseAction.
 *
 * @param {object} engine          - ML engine instance
 * @param {Array}  board           - current board state
 * @param {string} mark            - AI's mark ('X' or 'O')
 * @param {object} profile         - MLPlayerProfile record
 * @param {number} profileWeight   - weight for profile bias (default 0.2)
 * @returns {number}               - chosen cell index
 */
export function adaptedChooseAction(engine, board, mark, profile, profileWeight = 0.2) {
  // Neural engines don't have a qtable — delegate normally
  if (!engine.qtable) {
    return engine.chooseAction(board, false)
  }

  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1

  // Get base Q-values
  const stateKey = board.join(',')
  const qvals = engine.getQValues(board)

  // Compute bias from player's move history for this state
  const movePatterns = profile.movePatterns || {}
  const statePatterns = movePatterns[stateKey] || {}
  const totalMovesFromState = Object.values(statePatterns).reduce((s, c) => s + Number(c), 0)

  // Compute adjusted Q-values and pick argmax
  let bestCell = empty[0]
  let bestQ = -Infinity

  for (const cell of empty) {
    const bias = totalMovesFromState > 0
      ? (Number(statePatterns[cell] || 0) / totalMovesFromState)
      : 0
    const qAdj = qvals[cell] + profileWeight * bias
    if (qAdj > bestQ) {
      bestQ = qAdj
      bestCell = cell
    }
  }

  return bestCell
}
