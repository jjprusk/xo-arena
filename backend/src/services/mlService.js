// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * ML Service — CRUD, training orchestration, in-memory cache.
 *
 * Training runs as a background setImmediate loop, yielding every
 * BATCH_SIZE episodes so the event loop stays responsive. Progress
 * is fanned out over both transports: legacy Socket.io to the
 * `training:{id}` room, and the SSE+POST stream on the matching
 * channel prefix `training:{id}:`. Phase 4 of the realtime migration
 * (doc/Realtime_Migration_Plan.md) lets clients pick their transport
 * via the `realtime.ml.via` flag.
 */

import db from '../lib/db.js'
import { resetBotElo } from './userService.js'
import {
  QLearningEngine, runEpisode, DEFAULT_CONFIG,
  SarsaEngine,
  MonteCarloEngine,
  PolicyGradientEngine,
  DQNEngine,
  AlphaZeroEngine,
  minimaxMove,
  getWinner, isBoardFull, getEmptyCells, opponent,
  proportionPValue, twoProportionPValue,
} from '@xo-arena/ai'
import logger from '../logger.js'
import { completeStep as completeJourneyStep } from './journeyService.js'
import { grantDiscoveryReward } from './discoveryRewardsService.js'
import { appendToStream } from '../lib/eventStream.js'
import { resolvePreset } from '../config/trainingPresets.js'
import { hasRole } from '../utils/roles.js'
import { runEvalBatch, recordEvalMetrics, DEFAULT_EVAL_BUDGET } from '../lib/evalCurves.js'
import {
  requestPause as _busRequestPause,
  requestCancel as _busRequestCancel,
  isPaused as _busIsPaused,
  isCancelled as _busIsCancelled,
  clearPause as _busClearPause,
  clearCancel as _busClearCancel,
} from '../lib/signalBus.js'

/**
 * A3a.6 — count this user's currently-active training sessions and compare
 * to the per-user cap. Active = status PENDING or RUNNING (the queued and
 * approval-pending rows still consume the user's allotment so they can't
 * stack up an unbounded backlog). Cap defaults to 1; admins get an override
 * via `ml.maxActiveSessionsForAdmin` (0 = unlimited).
 *
 * Throws if the user is at or above their cap. No-op when ownerBaId is
 * null (admin-seeded skills with no owner).
 */
async function _enforceUserConcurrencyCap(ownerBaId) {
  if (!ownerBaId) return
  const owner = await db.user.findUnique({
    where:  { betterAuthId: ownerBaId },
    select: { id: true, userRoles: { select: { role: true } } },
  })
  if (!owner) return  // user gone — let the create fail loudly downstream if needed

  const isAdmin = hasRole(owner, 'ADMIN')
  const [defaultCap, adminCap] = await Promise.all([
    getSystemConfig('ml.maxActiveSessionsPerUser', 1),
    getSystemConfig('ml.maxActiveSessionsForAdmin', 0),
  ])
  const cap = isAdmin && adminCap > 0 ? adminCap : defaultCap
  if (cap <= 0) return  // 0 = unlimited

  const activeCount = await db.trainingSession.count({
    where: {
      status: { in: ['PENDING', 'RUNNING'] },
      model:  { createdBy: ownerBaId },
    },
  })

  if (activeCount >= cap) {
    throw new Error(`Training limit: you already have ${activeCount} active session${activeCount !== 1 ? 's' : ''} (max ${cap})`)
  }
}

// ─── In-memory caches ───────────────────────────────────────────────────────

/**
 * Lightweight LRU Map — same interface as Map (has/get/set/delete).
 * On `get`, the entry is moved to tail (most-recently-used).
 * On `set`, if at capacity, the head (least-recently-used) is evicted first.
 * Internally backed by a plain Map which preserves insertion order.
 */
class LRUMap {
  constructor(maxSize = 20) {
    this.maxSize = maxSize
    this._map = new Map()
  }
  has(key) { return this._map.has(key) }
  get(key) {
    if (!this._map.has(key)) return undefined
    const val = this._map.get(key)
    this._map.delete(key)
    this._map.set(key, val)   // move to tail
    return val
  }
  set(key, val) {
    if (this._map.has(key)) this._map.delete(key)   // refresh position
    else if (this._map.size >= this.maxSize) {
      // evict LRU (first entry)
      this._map.delete(this._map.keys().next().value)
    }
    this._map.set(key, val)
    return this
  }
  delete(key) { return this._map.delete(key) }
}
export { LRUMap }

/** modelId → engine instance (loaded on first move, invalidated after training) */
const engineCache = new LRUMap(20)

// A3b.2b — pause/cancel signals route through signalBus.js so they cross
// process boundaries when the worker path is on. The local Sets that
// used to live here are now an in-memory backend inside signalBus.

// ─── Training queue ──────────────────────────────────────────────────────────
/** Queue of pending training requests: [{ modelId, sessionId, opts }, ...] */
const trainingQueue = []

/**
 * Phase 3.8.4.3 — repoint a bot's primary skill (`User.botModelId`) at the
 * skill that just finished training so Profile "last-trained" / Gym sidebar
 * stay accurate without a manual select.
 *
 * Best-effort: returns `false` on any failure (logged at warn). BotSkill.botId
 * is a plain String — no FK relation back to User — so the bot is resolved in
 * two steps. Exported so the same logic can be tested in isolation and is
 * reused by both the backend training loop and the frontend completion path.
 *
 * Also writes `botModelType` derived from the skill's `algorithm`. Without
 * this, a bot that started life as a minimax Quick Bot (botModelType='minimax',
 * botModelId='user:…:minimax:…') would land in a half-converted state after
 * the first ML training: botModelId pointing at the new skill UUID but
 * botModelType still saying 'minimax'. That broke journey step 4's
 * `train-guided/finalize` flip because the finalize handler's "did model
 * change?" guard checks botModelId equality and finds them already aligned.
 */
export async function repointBotPrimarySkill(modelId) {
  try {
    const skillRow = await db.botSkill.findUnique({
      where:  { id: modelId },
      select: { botId: true, algorithm: true },
    })
    if (!skillRow?.botId) return false
    const modelType = botModelTypeFromAlgorithm(skillRow.algorithm)
    await db.user.update({
      where: { id: skillRow.botId },
      data:  { botModelId: modelId, ...(modelType ? { botModelType: modelType } : {}) },
    })
    return true
  } catch (e) {
    logger.warn({ err: e?.message, modelId }, 'auto-repoint botModelId failed')
    return false
  }
}

// BotSkill.algorithm uses Prisma-style upper-snake-case ('Q_LEARNING',
// 'MONTE_CARLO'); User.botModelType uses lowercase no-underscore
// ('qlearning', 'montecarlo'). Same mapping in skillService.js — keep in sync.
function botModelTypeFromAlgorithm(alg) {
  if (!alg || typeof alg !== 'string') return null
  return alg.toLowerCase().replace(/_/g, '')
}

// ─── Model CRUD ─────────────────────────────────────────────────────────────

export async function listModels() {
  const models = await db.botSkill.findMany({
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
  return db.botSkill.create({
    data: { name, description: description || null, algorithm, weights: {}, config: mergedConfig, createdBy, maxEpisodes },
  })
}

export async function getModel(id) {
  const model = await db.botSkill.findUnique({
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
  return db.botSkill.update({
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
  return db.botSkill.delete({ where: { id } })
}

export async function resetModel(id) {
  engineCache.delete(id)
  const model = await db.botSkill.findUnique({ where: { id } })
  if (!model) throw new Error('Model not found')
  const freshConfig = { ...model.config, currentEpsilon: model.config.epsilonStart ?? DEFAULT_CONFIG.epsilonStart }
  const updated = await db.botSkill.update({
    where: { id },
    data: { weights: {}, totalEpisodes: 0, status: 'IDLE', config: freshConfig },
  })

  // If this model is owned by a bot, reset its ELO and trigger calibration
  const bot = await db.user.findFirst({ where: { botModelId: id, isBot: true } })
  if (bot) {
    resetBotElo(bot.id).catch((err) =>
      console.error('[mlService] resetBotElo after resetModel failed:', err.message)
    )
  }

  return updated
}

export async function cloneModel(id, { name, description, createdBy = null }) {
  const src = await db.botSkill.findUnique({ where: { id } })
  if (!src) throw new Error('Source model not found')
  return db.botSkill.create({
    data: {
      name: name || `${src.name} (copy)`,
      description: description || src.description,
      algorithm: src.algorithm,
      weights: src.weights,
      config: src.config,
      totalEpisodes: src.totalEpisodes,
      maxEpisodes: src.maxEpisodes,
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
    select: { id: true, modelId: true, episodeNum: true, epsilon: true, createdAt: true },
  })
}

export async function restoreCheckpoint(modelId, checkpointId) {
  const cp = await db.mLCheckpoint.findUnique({ where: { id: checkpointId } })
  if (!cp || cp.modelId !== modelId) throw new Error('Checkpoint not found')
  engineCache.delete(modelId)
  const newConfig = await db.botSkill.findUnique({ where: { id: modelId }, select: { config: true } })
  return db.botSkill.update({
    where: { id: modelId },
    data: {
      weights: cp.weights,
      totalEpisodes: cp.episodeNum,
      status: 'IDLE',
      config: { ...newConfig.config, currentEpsilon: cp.epsilon },
    },
  })
}

// ─── Opening book ────────────────────────────────────────────────────────────

export async function getOpeningBook(modelId) {
  const model = await db.botSkill.findUnique({ where: { id: modelId }, select: { weights: true } })
  if (!model) throw new Error('Model not found')
  const qtable = model.weights

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
  const model = await db.botSkill.findUnique({ where: { id: modelId }, select: { weights: true } })
  return model?.weights ?? {}
}

export async function getMoveForModel(modelId, board) {
  if (!engineCache.has(modelId)) {
    const model = await db.botSkill.findUnique({ where: { id: modelId } })
    if (!model) throw new Error(`ML model ${modelId} not found`)
    const engine = new QLearningEngine(model.config)
    engine.loadQTable(model.weights)
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
    const model = await db.botSkill.findUnique({ where: { id: modelId } })
    if (!model) throw new Error(`ML model ${modelId} not found`)
    const engine = new QLearningEngine(model.config)
    engine.loadQTable(model.weights)
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
  // ELO is now tracked in GameElo (per user/bot), not on BotSkill.
  // ML model-vs-model ELO is tracked only via MLEloHistory with a fixed baseline of 1200.
  const BASE_ELO = 1200
  const sA = outcome === 'WIN' ? 1 : outcome === 'DRAW' ? 0.5 : 0
  const sB = 1 - sA
  const eA = _expectedScore(BASE_ELO, BASE_ELO)
  const eB = eA
  const newA = parseFloat((BASE_ELO + ELO_K * (sA - eA)).toFixed(2))
  const newB = parseFloat((BASE_ELO + ELO_K * (sB - eB)).toFixed(2))
  await db.$transaction([
    db.mLEloHistory.create({ data: { modelId: modelAId, eloRating: newA, delta: parseFloat((newA - BASE_ELO).toFixed(2)), opponentId: modelBId, opponentType: 'ML', outcome: outcome === 'WIN' ? 'WIN' : outcome === 'DRAW' ? 'DRAW' : 'LOSS' } }),
    db.mLEloHistory.create({ data: { modelId: modelBId, eloRating: newB, delta: parseFloat((newB - BASE_ELO).toFixed(2)), opponentId: modelAId, opponentType: 'ML', outcome: outcome === 'WIN' ? 'LOSS' : outcome === 'DRAW' ? 'DRAW' : 'WIN' } }),
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
  engine.loadQTable(model.weights)
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
  const model = await db.botSkill.findUnique({ where: { id: modelId } })
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
    db.botSkill.findUnique({ where: { id: modelAId } }),
    db.botSkill.findUnique({ where: { id: modelBId } }),
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
    const models = await Promise.all(modelIds.map(id => db.botSkill.findUnique({ where: { id } })))
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
  const model = await db.botSkill.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')
  return db.mLCheckpoint.create({
    data: {
      modelId,
      episodeNum: model.totalEpisodes,
      weights: model.weights,
      epsilon: model.config?.currentEpsilon ?? model.config?.epsilonStart ?? 1.0,
    },
  })
}

export async function getCheckpoint(modelId, checkpointId) {
  const cp = await db.mLCheckpoint.findUnique({ where: { id: checkpointId } })
  if (!cp || cp.modelId !== modelId) throw new Error('Checkpoint not found')
  return cp
}

export async function exportModel(modelId) {
  const model = await db.botSkill.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')
  // eslint-disable-next-line no-unused-vars
  const { id, createdAt, updatedAt, ...rest } = model
  return rest
}

export async function importModel(data) {
  const { name, description, algorithm, config, qtable, weights, totalEpisodes, createdBy = null } = data
  if (!name?.trim()) throw new Error('name is required')
  const mergedConfig = { ...DEFAULT_CONFIG, ...(config || {}) }
  const maxEpisodes = await getSystemConfig('ml.maxEpisodesPerModel', 100_000)
  return db.botSkill.create({
    data: {
      name: name.trim(),
      description: description || null,
      algorithm: algorithm || 'Q_LEARNING',
      config: mergedConfig,
      weights: weights || qtable || {},
      totalEpisodes: totalEpisodes || 0,
      maxEpisodes,
      createdBy,
    },
  })
}

// ─── Training ────────────────────────────────────────────────────────────────

export async function startTraining(modelId, { mode, iterations, config = {}, preset = null }) {
  const model = await getModel(modelId)
  if (!model) throw new Error('Model not found')

  // A3a.4 — if a preset is named, resolve it to iterations + ETA and let
  // it override the iterations arg. Persisted on the session row so the
  // approval queue (A3a.5) and the UI can see what the user actually asked
  // for. Unknown (algorithm, preset) combinations throw early.
  let expectedDurationMs = null
  if (preset) {
    const resolved = resolvePreset({
      gameId:    model.gameId,
      algorithm: model.algorithm,
      preset,
    })
    if (!resolved) {
      throw new Error(`Unknown preset '${preset}' for ${model.algorithm} on ${model.gameId}`)
    }
    iterations        = resolved.iterations
    expectedDurationMs = resolved.expectedDurationMs
  }

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
    const runningCount = await db.botSkill.count({ where: { status: 'TRAINING' } })
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

  // A3a.6 — per-user concurrency cap.
  await _enforceUserConcurrencyCap(model.createdBy ?? null)

  // A3a.5 — ETA-threshold gate. Sessions whose preset-resolved runtime
  // exceeds `ml.approvalThresholdMs` (default 4hr) create as PENDING with
  // `approvalStatus = 'NEEDED'` and do NOT start the training loop. An
  // admin acts via /admin/training/:id/{approve,deny}; on approve the loop
  // is started via `startApprovedSession`. Sessions with no
  // `expectedDurationMs` (legacy iterations-direct callers) are never gated.
  const thresholdMs = await getSystemConfig('ml.approvalThresholdMs', 4 * 60 * 60 * 1000)
  if (expectedDurationMs !== null && expectedDurationMs >= thresholdMs) {
    const session = await db.trainingSession.create({
      data: {
        modelId, mode, iterations,
        status:              'PENDING',
        config, preset, expectedDurationMs,
        approvalStatus:      'NEEDED',
        approvalRequestedAt: new Date(),
      },
    })
    logger.info(
      { modelId, sessionId: session.id, preset, expectedDurationMs, thresholdMs },
      'Training session awaiting admin approval'
    )
    return session
  }

  if (model.status === 'TRAINING') {
    // Queue the session instead of throwing 409
    const session = await db.trainingSession.create({
      data: { modelId, mode, iterations, status: 'PENDING', config, preset, expectedDurationMs },
    })
    trainingQueue.push({ modelId, sessionId: session.id, opts: { mode, iterations, config } })
    logger.info({ modelId, sessionId: session.id }, 'Training queued')
    return session
  }

  // A3b.2b — dispatch routing. With `ml.useWorker` true, mint the session
  // tagged with `dispatch:'worker'` and enqueue a `training:start` job
  // instead of running the loop in-process. The flag is read fresh every
  // call so a SystemConfig flip is the kill switch — no deploy required
  // to roll back. Default off keeps existing setImmediate behavior intact.
  const useWorker = await getSystemConfig('ml.useWorker', false)
  const dispatch  = useWorker ? 'worker' : 'in-process'

  const session = await db.trainingSession.create({
    data: {
      modelId, mode, iterations,
      status: 'RUNNING',
      config: { ...config, dispatch },
      preset,
      expectedDurationMs,
    },
  })
  await db.botSkill.update({ where: { id: modelId }, data: { status: 'TRAINING' } })

  if (useWorker) {
    const { enqueueTrainingStart } = await import('../queue/trainingQueue.js')
    await enqueueTrainingStart(session.id)
    logger.info({ modelId, sessionId: session.id }, 'training session dispatched to worker')
  } else {
    setImmediate(() => _runTraining(model, session, { mode, iterations, config: session.config }))
  }
  return session
}

/**
 * A3a.5 — admin acts on a pending-approval session.
 *
 * Approves a session that was held by the ETA gate, marks approvedBy +
 * approvedAt, and starts the training loop (queuing if the model is busy).
 * Returns the updated session.
 *
 * Throws if the session is not in PENDING + NEEDED state (so a re-approve
 * or a post-deny approve fails fast).
 */
export async function approveSession(sessionId, approvedByUserId) {
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Session not found')
  if (session.approvalStatus !== 'NEEDED') {
    throw new Error(`Session not awaiting approval (approvalStatus=${session.approvalStatus ?? 'null'})`)
  }
  if (session.status !== 'PENDING') {
    throw new Error(`Session is in status ${session.status}, expected PENDING`)
  }

  const model = await getModel(session.modelId)
  if (!model) throw new Error('Model not found')

  await db.trainingSession.update({
    where: { id: sessionId },
    data:  {
      approvalStatus: 'APPROVED',
      approvedAt:     new Date(),
      approvedById:   approvedByUserId ?? null,
    },
  })

  // Same queue-or-run decision as startTraining post-gate.
  if (model.status === 'TRAINING') {
    trainingQueue.push({
      modelId:   session.modelId,
      sessionId: session.id,
      opts:      { mode: session.mode, iterations: session.iterations, config: session.config },
    })
    logger.info({ sessionId, approvedByUserId }, 'Approved session queued (model busy)')
  } else {
    await db.trainingSession.update({
      where: { id: sessionId },
      data:  { status: 'RUNNING', startedAt: new Date() },
    })
    await db.botSkill.update({ where: { id: session.modelId }, data: { status: 'TRAINING' } })
    const refreshed = { ...session, status: 'RUNNING', approvalStatus: 'APPROVED' }
    setImmediate(() => _runTraining(model, refreshed, {
      mode:       session.mode,
      iterations: session.iterations,
      config:     session.config,
    }))
    logger.info({ sessionId, approvedByUserId }, 'Approved session started')
  }

  return db.trainingSession.findUnique({ where: { id: sessionId } })
}

/** A3a.5 — admin denies a pending-approval session; marks it CANCELLED terminally. */
export async function denySession(sessionId, deniedByUserId, reason = null) {
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Session not found')
  if (session.approvalStatus !== 'NEEDED') {
    throw new Error(`Session not awaiting approval (approvalStatus=${session.approvalStatus ?? 'null'})`)
  }

  return db.trainingSession.update({
    where: { id: sessionId },
    data:  {
      approvalStatus: 'DENIED',
      approvedAt:     new Date(),
      approvedById:   deniedByUserId ?? null,
      status:         'CANCELLED',
      completedAt:    new Date(),
      summary:        reason ? { deniedReason: reason } : undefined,
    },
  })
}

/** A3a.5 — list sessions awaiting admin approval, newest-first. */
export async function listPendingApprovals() {
  return db.trainingSession.findMany({
    where:   { approvalStatus: 'NEEDED' },
    orderBy: { approvalRequestedAt: 'desc' },
  })
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
    await db.botSkill.update({ where: { id: next.modelId }, data: { status: 'TRAINING' } })
    setImmediate(() => _runTraining(model, session, next.opts))
    logger.info({ modelId: next.modelId, sessionId: next.sessionId }, 'Queued training started')
  } catch (err) {
    logger.error({ err, next }, 'Failed to start queued training session')
  }
}

/**
 * A3a.9 — boot-time orphan recovery.
 *
 * A `TrainingSession.status = 'RUNNING'` row whose process is gone (crash,
 * fresh deploy, OOM kill) needs to either resume from its latest
 * checkpoint or be marked FAILED so the model doesn't stay locked in
 * `BotSkill.status = 'TRAINING'` forever.
 *
 * Called once at backend startup from `index.js`. Returns the per-session
 * action taken so tests / logs can assert on it. Failures don't throw —
 * each session is handled independently.
 */
export async function resumeOrphanedSessions() {
  // Skip sessions the user explicitly paused — pausedAt set means they
  // *want* it stopped; the orphan resumer must not undo that.
  // A3b.2b — also skip sessions dispatched to the xo-training worker:
  // their recovery is owned by BullMQ's stalled-job + heartbeat mechanism,
  // not the backend boot scan. If both fired they'd race for the model
  // lock and one would land on a half-applied checkpoint. We can't filter
  // `config.dispatch` in the Prisma query (JSON field on SQLite test
  // backends), so we filter in JS post-fetch.
  const orphansRaw = await db.trainingSession.findMany({
    where:   { status: 'RUNNING', pausedAt: null },
    include: { model: true },
  })
  const orphans = orphansRaw.filter(s => (s.config?.dispatch ?? 'in-process') !== 'worker')
  if (orphans.length === 0) return []

  logger.info({ count: orphans.length }, 'resuming orphaned training sessions')

  const results = []
  for (const session of orphans) {
    try {
      const checkpoint = await db.trainingCheckpoint.findFirst({
        where:   { sessionId: session.id },
        orderBy: { episodeNum: 'desc' },
      })

      if (!checkpoint) {
        // No checkpoint to resume from — mark FAILED so the model unlocks.
        await db.trainingSession.update({
          where: { id: session.id },
          data:  { status: 'FAILED', completedAt: new Date(),
                   summary: { resumeError: 'no checkpoint available' } },
        })
        await db.botSkill.update({
          where: { id: session.modelId },
          data:  { status: 'IDLE' },
        }).catch(() => {})
        results.push({ sessionId: session.id, action: 'failed_no_checkpoint' })
        logger.warn({ sessionId: session.id }, 'orphan with no checkpoint marked FAILED')
        continue
      }

      // Reload pre-checkpoint counters from TrainingEpisode rows so the final
      // summary reflects the whole session, not just the resume window.
      // (Best-effort; if the count query fails, summary will under-report.)
      // We just need the model + options to restart training from the
      // checkpoint episode.
      setImmediate(() => _runTraining(session.model, session, {
        mode:         session.mode,
        iterations:   session.iterations,
        config:       session.config,
        startEpisode: checkpoint.episodeNum,
        resumedEngineState: {
          weights: checkpoint.weights,
          epsilon: checkpoint.runtimeState?.epsilon ?? null,
        },
      }))
      results.push({ sessionId: session.id, action: 'resumed', from: checkpoint.episodeNum })
      logger.info({ sessionId: session.id, from: checkpoint.episodeNum }, 'orphan resumed from checkpoint')
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'orphan resume failed')
      results.push({ sessionId: session.id, action: 'error', error: err.message })
    }
  }
  return results
}

/**
 * A3b.2a — run an existing TrainingSession from a queue job.
 *
 * The worker handler (`backend/src/queue/jobs/trainingStart.js`) calls
 * this with a sessionId after picking the job off the BullMQ queue. We
 * resolve the session + model + latest checkpoint (so a re-enqueued job
 * resumes from where the previous attempt left off, matching the
 * setImmediate path's crash-recovery behavior).
 *
 * The caller is expected to have already created the TrainingSession
 * row (status RUNNING) and flipped the BotSkill to TRAINING — this
 * function just executes the loop. That mirrors what startTraining()
 * does today before the setImmediate; A3b.2b lifts the create+enqueue
 * pair into startTraining itself behind a SystemConfig flag.
 */
export async function _runTrainingForQueueJob(sessionId) {
  const session = await db.trainingSession.findUnique({
    where:   { id: sessionId },
    include: { model: true },
  })
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  if (!session.model) throw new Error(`Model not found for session: ${sessionId}`)

  const checkpoint = await db.trainingCheckpoint.findFirst({
    where:   { sessionId },
    orderBy: { episodeNum: 'desc' },
  })

  await _runTraining(session.model, session, {
    mode:         session.mode,
    iterations:   session.iterations,
    config:       session.config,
    startEpisode: checkpoint?.episodeNum ?? 0,
    resumedEngineState: checkpoint ? {
      weights: checkpoint.weights,
      epsilon: checkpoint.runtimeState?.epsilon ?? null,
    } : null,
  })

  return { completed: true, resumedFrom: checkpoint?.episodeNum ?? 0 }
}

/**
 * A3a.10 — request a graceful pause. Adds the session to the pausedSessions
 * signal Set; the training loop's next tick force-writes a checkpoint and
 * transitions the row to PENDING + pausedAt. Returns immediately — the loop
 * does the heavy lifting async. Throws if the session isn't currently
 * RUNNING (or if it's already paused).
 */
export async function pauseSession(sessionId) {
  const s = await db.trainingSession.findUnique({ where: { id: sessionId } })
  if (!s) throw new Error('Session not found')
  if (s.status !== 'RUNNING') throw new Error(`Session is in status ${s.status}, expected RUNNING`)
  if (s.pausedAt)             throw new Error('Session is already paused')
  _busRequestPause(sessionId)
  return s
}

/**
 * A3a.10 — resume a paused session. Clears pausedAt, finds the latest
 * checkpoint, and restarts `_runTraining` from that point with the
 * checkpoint's weights + runtime state. If the model is busy, queues the
 * resume instead of stepping on the in-flight session.
 */
export async function resumeSession(sessionId) {
  const session = await db.trainingSession.findUnique({
    where:   { id: sessionId },
    include: { model: true },
  })
  if (!session) throw new Error('Session not found')
  if (!session.pausedAt) throw new Error('Session is not paused')

  const checkpoint = await db.trainingCheckpoint.findFirst({
    where:   { sessionId },
    orderBy: { episodeNum: 'desc' },
  })
  if (!checkpoint) throw new Error('Cannot resume: no checkpoint available')

  // Clear the pause + signal Set; flip the session row to RUNNING so the
  // owner-view shows the right state immediately.
  _busClearPause(sessionId)
  await db.trainingSession.update({
    where: { id: sessionId },
    data:  { pausedAt: null, status: 'RUNNING' },
  })

  if (session.model.status === 'TRAINING') {
    // Model is busy — queue the resume instead of stepping on it.
    trainingQueue.push({
      modelId:   session.modelId,
      sessionId,
      opts: {
        mode: session.mode, iterations: session.iterations, config: session.config,
        startEpisode: checkpoint.episodeNum,
        resumedEngineState: {
          weights: checkpoint.weights,
          epsilon: checkpoint.runtimeState?.epsilon ?? null,
        },
      },
    })
    logger.info({ sessionId }, 'resume queued (model busy)')
  } else {
    await db.botSkill.update({ where: { id: session.modelId }, data: { status: 'TRAINING' } })
    setImmediate(() => _runTraining(session.model, session, {
      mode:         session.mode,
      iterations:   session.iterations,
      config:       session.config,
      startEpisode: checkpoint.episodeNum,
      resumedEngineState: {
        weights: checkpoint.weights,
        epsilon: checkpoint.runtimeState?.epsilon ?? null,
      },
    }))
    logger.info({ sessionId, from: checkpoint.episodeNum }, 'session resumed')
  }

  return db.trainingSession.findUnique({ where: { id: sessionId } })
}

export async function cancelSession(sessionId) {
  _busRequestCancel(sessionId)
  // DB update happens inside the loop when it detects cancellation;
  // if session already completed, update it here as fallback
  const s = await db.trainingSession.findUnique({ where: { id: sessionId } })
  if (s && s.status === 'RUNNING') {
    await db.trainingSession.update({
      where: { id: sessionId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    })
    await db.botSkill.update({ where: { id: s.modelId }, data: { status: 'IDLE' } })
  }
}

/**
 * Create a training session for a frontend-driven training run.
 * Returns the session + current model weights so the frontend can initialise the engine.
 * The frontend calls finishTrainingFromFrontend() when done.
 */
export async function startFrontendSession(modelId, { mode, iterations, config = {}, preset = null }) {
  const model = await getModel(modelId)
  if (!model) throw new Error('Model not found')

  // A3a.4 — same preset resolution as startTraining.
  let expectedDurationMs = null
  if (preset) {
    const resolved = resolvePreset({
      gameId:    model.gameId,
      algorithm: model.algorithm,
      preset,
    })
    if (!resolved) {
      throw new Error(`Unknown preset '${preset}' for ${model.algorithm} on ${model.gameId}`)
    }
    iterations        = resolved.iterations
    expectedDurationMs = resolved.expectedDurationMs
  }

  if (iterations < 1 || iterations > 100_000) throw new Error('iterations must be 1–100,000')

  const [maxEpisodes, maxConcurrent] = await Promise.all([
    getSystemConfig('ml.maxEpisodesPerSession', 100_000),
    getSystemConfig('ml.maxConcurrentSessions', 0),
  ])
  if (maxEpisodes > 0 && iterations > maxEpisodes) {
    throw new Error(`Training limit: max ${maxEpisodes.toLocaleString()} episodes per session`)
  }
  if (maxConcurrent > 0) {
    const runningCount = await db.botSkill.count({ where: { status: 'TRAINING' } })
    if (runningCount >= maxConcurrent) {
      throw new Error(`Training limit: max ${maxConcurrent} concurrent session${maxConcurrent !== 1 ? 's' : ''}`)
    }
  }
  if (model.maxEpisodes > 0) {
    const remaining = model.maxEpisodes - model.totalEpisodes
    if (remaining <= 0) {
      throw new Error(`Training limit: this model has reached its ${model.maxEpisodes.toLocaleString()} episode maximum`)
    }
    if (iterations > remaining) {
      throw new Error(`Training limit: only ${remaining.toLocaleString()} episodes remain (limit: ${model.maxEpisodes.toLocaleString()}, used: ${model.totalEpisodes.toLocaleString()})`)
    }
  }
  if (model.status === 'TRAINING') throw new Error('Model is already training')

  // A3a.6 — per-user concurrency cap.
  await _enforceUserConcurrencyCap(model.createdBy ?? null)

  const session = await db.trainingSession.create({
    data: {
      modelId, mode, iterations,
      status: 'RUNNING',
      config: { ...config, frontend: true },
      preset, expectedDurationMs,
    },
  })
  await db.botSkill.update({ where: { id: modelId }, data: { status: 'TRAINING' } })
  logger.info({ modelId, sessionId: session.id }, 'Frontend training session started')

  return {
    session,
    model: {
      config: model.config,
      weights: model.weights,
      algorithm: model.algorithm,
    },
  }
}

/**
 * Called by the frontend after it finishes (or cancels) a training run.
 * Persists the weights, updates the session, triggers ELO calibration in the background.
 */
export async function finishTrainingFromFrontend(sessionId, { weights, stats, iterations, status = 'COMPLETED', samples }) {
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } })
  if (!session) throw new Error('Session not found')
  const modelId = session.modelId

  const { wins = 0, losses = 0, draws = 0, totalQDelta = 0, finalEpsilon = 0, stateCount = 0 } = stats || {}
  const safeIterations = iterations || 0

  const summary = {
    wins, losses, draws,
    winRate:   safeIterations > 0 ? wins  / safeIterations : 0,
    avgQDelta: safeIterations > 0 ? totalQDelta / safeIterations : 0,
    finalEpsilon,
    stateCount,
  }

  const currentModel = await db.botSkill.findUnique({ where: { id: modelId }, select: { config: true } })

  // Sync DQN architecture if it changed during training
  const configOverride = {}
  const sessionConfig = session.config || {}
  if (sessionConfig.networkShape) {
    const ls = [9, ...sessionConfig.networkShape.map(Number), 9]
    configOverride.layerSizes   = ls
    configOverride.networkShape = sessionConfig.networkShape.map(Number)
  }

  // Build episode records from sampled data sent by the browser
  const episodeRecords = Array.isArray(samples) ? samples.map(s => ({
    sessionId,
    episodeNum: s.episodeNum,
    outcome:    s.outcome,
    totalMoves: s.totalMoves ?? 5,
    avgQDelta:  s.avgQDelta  ?? 0,
    epsilon:    s.epsilon    ?? 0,
    durationMs: 0,
  })) : []

  await db.$transaction([
    db.botSkill.update({
      where: { id: modelId },
      data: {
        weights: weights || {},
        status: 'IDLE',
        totalEpisodes: { increment: safeIterations },
        config: { ...currentModel.config, ...configOverride, currentEpsilon: finalEpsilon },
      },
    }),
    db.trainingSession.update({
      where: { id: sessionId },
      data: { status, completedAt: new Date(), summary },
    }),
    ...(episodeRecords.length > 0 ? [db.trainingEpisode.createMany({ data: episodeRecords })] : []),
  ])

  engineCache.delete(modelId)

  if (status === 'COMPLETED') await repointBotPrimarySkill(modelId)

  logger.info({ sessionId, modelId, status, samples: episodeRecords.length, ...summary }, 'Frontend training finished')

  // Journey step 4 (Curriculum: Train your bot) — fire-and-forget.
  // Was step 6 in the legacy spec; renumbered in the v1 Intelligent Guide
  // rewrite (§4). Fires on any completed training run with iterations > 0.
  // Also grants the §5.7 "first non-default-algorithm" discovery reward —
  // any successful BotSkill train is by definition non-minimax (Quick Bot
  // tier-bumps go through bots/train-quick, not here).
  if (safeIterations > 0) {
    db.botSkill.findUnique({ where: { id: modelId }, select: { createdBy: true } })
      .then(async model => {
        if (!model?.createdBy) return
        const user = await db.user.findUnique({ where: { betterAuthId: model.createdBy }, select: { id: true } })
        if (user) {
          completeJourneyStep(user.id, 4).catch(() => {})
          grantDiscoveryReward(user.id, 'firstNonDefaultAlgorithm').catch(() => {})
        }
      })
      .catch(() => {})
  }

  // ELO calibration — non-blocking background task
  setImmediate(async () => {
    try {
      const freshModel  = await db.botSkill.findUnique({ where: { id: modelId } })
      const calibEngine = _greedyEngine(freshModel)
      const CALIBRATION_OPPONENTS = [
        { difficulty: 'novice',       fixedElo: 800  },
        { difficulty: 'intermediate', fixedElo: 1200 },
        { difficulty: 'advanced',     fixedElo: 1500 },
        { difficulty: 'master',       fixedElo: 1800 },
      ]
      const CALIB_GAMES = 100
      let currentElo = 1200
      for (const { difficulty, fixedElo } of CALIBRATION_OPPONENTS) {
        const r = _runGames(calibEngine, (b, p) => minimaxMove(b, difficulty, p), CALIB_GAMES)
        const actual   = (r.wins + r.draws * 0.5) / CALIB_GAMES
        const expected = _expectedScore(currentElo, fixedElo)
        currentElo = parseFloat((currentElo + ELO_K * (actual - expected)).toFixed(2))
        await new Promise(res => setImmediate(res))
      }
      const delta = parseFloat((currentElo - 1200).toFixed(2))
      const outcome = delta > 0 ? 'WIN' : delta < 0 ? 'LOSS' : 'DRAW'
      await db.mLEloHistory.create({ data: { modelId, eloRating: currentElo, delta, opponentType: 'MINIMAX', outcome } })
      logger.info({ modelId, newElo: currentElo, delta }, 'ELO calibrated after frontend training')
    } catch (eloErr) {
      logger.warn({ eloErr }, 'ELO calibration after frontend training failed (non-fatal)')
    }
  })
}

// ─── Training loop (private) ─────────────────────────────────────────────────

const BATCH_SIZE     = 50    // episodes per DB batch insert
const CHECKPOINT_GAP = 1000  // save checkpoint every N episodes
const EVAL_GAP       = 1000  // A3a.7: write a TrainingMetric eval point every N episodes

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

  // Track each ML player's last pushed experience so we can retroactively push a
  // terminal -1 when the *opponent* makes the final winning move (in that case
  // isML=false and nothing gets pushed for the losing player's last move).
  const lastMLExp = {}  // mark → { encodedPrev, action, encodedNext }

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
    } else if (isML) {
      // Intermediate reward shaping — only for non-terminal ML moves
      reward = _dqnShapeReward(prevBoard, board, action, currentPlayer)
    }

    if (isML) {
      const encodedPrev = _encodeStateForDQN(prevBoard, currentPlayer)
      const encodedNext = _encodeStateForDQN(board, opponent(currentPlayer))
      lastMLExp[currentPlayer] = { encodedPrev, action, encodedNext }
      engine.pushExperience(encodedPrev, action, reward, encodedNext, done)
      engine.trainStep()
    }

    if (done) {
      // Retroactive terminal push for the loser's last experience.
      // When the opponent wins on their turn (isML=false), the losing ML player's
      // most recent push had reward=0/done=false — it saw no penalty for the position
      // that allowed the loss. Push a terminal -1 now so the network gets that signal.
      if (winner) {
        const loser = winner === 'X' ? 'O' : 'X'
        const loserIsML = mlMark === 'both' || loser === mlMark
        if (loserIsML && lastMLExp[loser]) {
          const { encodedPrev, action: loserAction, encodedNext } = lastMLExp[loser]
          engine.pushExperience(encodedPrev, loserAction, -1.0, encodedNext, true)
          engine.trainStep()
        }
      }

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
 * Intermediate reward shaping for non-terminal DQN moves.
 * Provides small signals to guide learning without changing the optimal policy:
 *  +0.3  blocking the opponent's immediate winning threat
 *  +0.1  creating a winning threat (ML can win next opportunity)
 */
function _dqnShapeReward(prevBoard, board, action, mark) {
  let bonus = 0
  const opp = mark === 'X' ? 'O' : 'X'

  // Blocking bonus: was `action` the move that stopped an opponent immediate win?
  for (let i = 0; i < 9; i++) {
    if (prevBoard[i] !== null) continue
    const test = [...prevBoard]; test[i] = opp
    if (getWinner(test) === opp) {
      if (i === action) { bonus += 0.3; break }
    }
  }

  // Winning-threat bonus: after this move, ML has at least one immediate winning move
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue
    const test = [...board]; test[i] = mark
    if (getWinner(test) === mark) { bonus += 0.1; break }
  }

  return bonus
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

async function _runTraining(model, session, { mode, iterations, config, startEpisode = 0, resumedEngineState = null }) {
  const { id: sessionId, modelId } = { id: session.id, modelId: model.id }

  // Determine algorithm from config or model
  const algorithm = config.algorithm || model.algorithm || 'Q_LEARNING'

  // Build engine from current model state, merging per-session overrides
  // (epsilonDecay, epsilonMin, decayMethod, batchSize, etc. from the UI) into the stored model config.
  // Include totalEpisodes so linear/cosine schedules know the full run length.
  let sessionEngineConfig = { ...model.config, ...config, totalEpisodes: iterations }

  // DQN: handle per-session architecture override (networkShape or hiddenSize from the Train tab).
  // If the requested architecture differs from the stored one, reset weights — you can't continue
  // training a [9,32,9] network with [9,64,64,9] weights.
  let sessionQtable = model.weights
  if (algorithm === 'DQN') {
    const requestedShape = config.networkShape ?? (config.hiddenSize != null ? [config.hiddenSize] : null)
    if (requestedShape) {
      const requestedLayerSizes = [9, ...requestedShape.map(Number), 9]
      sessionEngineConfig = { ...sessionEngineConfig, layerSizes: requestedLayerSizes, networkShape: requestedShape.map(Number) }
      const storedLayerSizes = model.config.layerSizes ?? [9, 32, 9]
      if (JSON.stringify(requestedLayerSizes) !== JSON.stringify(storedLayerSizes)) {
        // Architecture changed — start with a fresh network (no weights to reuse)
        sessionQtable = {}
        logger.info({ sessionId, modelId, storedLayerSizes, requestedLayerSizes }, 'DQN architecture changed — resetting weights')
      }
    }
  }

  const engine = _buildEngine(sessionEngineConfig, algorithm)
  // A3a.9 — resume path: weights come from the latest checkpoint, not from
  // the model row. The runtime state ({ epsilon, ... }) is also restored so
  // exploration continues smoothly.
  engine.loadQTable(resumedEngineState?.weights ?? sessionQtable)
  if (resumedEngineState?.epsilon != null) {
    engine.epsilon = resumedEngineState.epsilon
  }

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
    if (startEpisode > 0) {
      logger.info({ sessionId, modelId, startEpisode, iterations }, 'training resumed from checkpoint')
    }
    for (let i = startEpisode; i < iterations; i++) {
      // Cooperative cancellation check
      if (_busIsCancelled(sessionId)) {
        _busClearCancel(sessionId)
        await _finishSession(sessionId, modelId, engine, actualEpisodes, 'CANCELLED', { wins, losses, draws, totalQDelta })
        return
      }

      // A3a.10 — cooperative pause. Force a checkpoint at the current
      // episode so resume picks up exactly here (no replay), flush any
      // pending episode batch, transition the session to PENDING + pausedAt,
      // and unlock the model. Exits the loop without _finishSession so the
      // session stays terminal-free; resumeSession() restarts it later.
      if (_busIsPaused(sessionId)) {
        _busClearPause(sessionId)
        const episodeNum = i
        try {
          if (episodeBatch.length > 0) {
            await db.trainingEpisode.createMany({ data: episodeBatch })
            episodeBatch.length = 0
          }
          await db.trainingCheckpoint.upsert({
            where:  { sessionId_episodeNum: { sessionId, episodeNum } },
            create: {
              sessionId, episodeNum,
              weights:      engine.toJSON(),
              runtimeState: { epsilon: engine.epsilon },
            },
            update: {
              weights:      engine.toJSON(),
              runtimeState: { epsilon: engine.epsilon },
            },
          })
          await db.trainingSession.update({
            where: { id: sessionId },
            data:  { status: 'PENDING', pausedAt: new Date(), checkpointEpisode: episodeNum },
          })
          await db.botSkill.update({ where: { id: modelId }, data: { status: 'IDLE' } })
          _emit(`training:${sessionId}`, 'training:paused', { sessionId, episode: episodeNum })
        } catch (err) {
          logger.error({ err, sessionId, episodeNum }, 'pause checkpoint failed; session may be stuck')
        }
        _processNextInQueue()
        return
      }

      const t0 = Date.now()
      const result = _runEpisodeForAlgorithm(engine, mlMark, opponentFn, algorithm)
      const durationMs = Date.now() - t0
      // QA harness hook: slow the loop so crash-recovery tests have time to
      // restart the backend mid-run. Honoured only when explicitly set in
      // config; zero perf cost otherwise. See `um training-recovery`.
      if (config._qaDelayMs > 0) {
        await new Promise(r => setTimeout(r, config._qaDelayMs))
      }
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
            _emit(`training:${sessionId}`, 'training:curriculum_advance', {
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
          _emit(`training:${sessionId}`, 'training:early_stop', { sessionId, episode: i + 1, bestWinRate })
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

      // Checkpoint — two distinct artefacts:
      //   • MLCheckpoint:       per-MODEL rolling history (kept for backward compat)
      //   • TrainingCheckpoint: per-SESSION resume point (A3a.9; lets a crashed
      //                         worker pick up where it left off on next boot)
      if ((i + 1) % CHECKPOINT_GAP === 0) {
        const episodeNum = i + 1
        await db.mLCheckpoint.create({
          data: { modelId, episodeNum: model.totalEpisodes + episodeNum, weights: engine.toJSON(), epsilon: engine.epsilon },
        })
        // Idempotent: unique on (sessionId, episodeNum) so a re-issued checkpoint
        // after resume on the same slot is rejected — that's the intended guard.
        await db.trainingCheckpoint.upsert({
          where:  { sessionId_episodeNum: { sessionId, episodeNum } },
          create: {
            sessionId, episodeNum,
            weights:      engine.toJSON(),
            runtimeState: { epsilon: engine.epsilon },
          },
          update: {},
        }).catch((err) => logger.warn({ err, sessionId, episodeNum }, 'TrainingCheckpoint write failed'))
        await db.trainingSession.update({
          where: { id: sessionId },
          data:  { checkpointEpisode: episodeNum },
        }).catch((err) => logger.warn({ err, sessionId, episodeNum }, 'checkpointEpisode pointer update failed'))
      }

      // A3a.7 — multi-curve eval. Every EVAL_GAP episodes, play a small
      // batch of games against [primary, easy, medium] minimax tiers and
      // persist the W/D/L tallies as TrainingMetric rows. Eval is
      // fire-and-forget — a transient failure must never abort training.
      if ((i + 1) % EVAL_GAP === 0) {
        const episodeNum = i + 1
        try {
          const records = runEvalBatch({
            modelMove:        (board) => engine.chooseAction(board, false),
            makeOpponentMove: (opponentId) => {
              const [, difficulty] = opponentId.split(':')
              return (board, player) => minimaxMove(board, difficulty, player)
            },
            algorithm,
            episodeNum,
          })
          recordEvalMetrics(db, sessionId, records).catch((err) =>
            logger.warn({ err, sessionId, episodeNum }, 'eval metric persist failed')
          )
        } catch (err) {
          logger.warn({ err, sessionId, episodeNum }, 'eval batch failed')
        }
      }

      // Progress broadcast + event-loop yield
      if ((i + 1) % PROGRESS_INTERVAL === 0 || i === iterations - 1) {
        const done = i + 1
        _emit(`training:${sessionId}`, 'training:progress', {
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
    await db.botSkill.update({ where: { id: modelId }, data: { status: 'IDLE' } })
    await db.trainingSession.update({ where: { id: sessionId }, data: { status: 'FAILED', completedAt: new Date() } })
    _emit(`training:${sessionId}`, 'training:error', { sessionId, error: err.message })
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
  const updatedConfig = await db.botSkill.findUnique({ where: { id: modelId }, select: { config: true } })
  // For DQN: keep model.config.layerSizes / networkShape in sync with what was actually trained.
  // This matters when the user changed the architecture via the Train tab — future sessions and
  // inference must use the updated architecture, not the stale creation-time shape.
  const configArchOverride = {}
  if (engine._online?.layerSizes) {
    const ls = engine._online.layerSizes
    configArchOverride.layerSizes   = ls
    configArchOverride.networkShape = ls.slice(1, -1)
  }
  await db.$transaction([
    db.botSkill.update({
      where: { id: modelId },
      data: {
        weights: engine.toJSON(),
        status: 'IDLE',
        totalEpisodes: { increment: iterations },
        config: { ...updatedConfig.config, ...configArchOverride, currentEpsilon: engine.epsilon },
      },
    }),
    db.trainingSession.update({
      where: { id: sessionId },
      data: { status, completedAt: new Date(), summary },
    }),
  ])
  engineCache.delete(modelId)

  if (status === 'COMPLETED') await repointBotPrimarySkill(modelId)

  _emit(`training:${sessionId}`, status === 'COMPLETED' ? 'training:complete' : 'training:cancelled', { sessionId, summary })
  logger.info({ sessionId, modelId, status, ...summary }, 'Training finished')

  // Start next queued session if any
  _processNextInQueue()

  // ELO calibration: play 100 games vs each fixed minimax level and update ELO
  try {
    const calibEngine = _greedyEngine(await db.botSkill.findUnique({ where: { id: modelId } }))
    const CALIBRATION_OPPONENTS = [
      { difficulty: 'novice',       fixedElo: 800  },
      { difficulty: 'intermediate', fixedElo: 1200 },
      { difficulty: 'advanced',     fixedElo: 1500 },
      { difficulty: 'master',       fixedElo: 1800 },
    ]
    const CALIB_GAMES = 100
    let currentElo = 1200
    for (const { difficulty, fixedElo } of CALIBRATION_OPPONENTS) {
      const r = _runGames(calibEngine, (b, p) => minimaxMove(b, difficulty, p), CALIB_GAMES)
      const actual   = (r.wins + r.draws * 0.5) / CALIB_GAMES
      const expected = _expectedScore(currentElo, fixedElo)
      currentElo = parseFloat((currentElo + ELO_K * (actual - expected)).toFixed(2))
      await new Promise(res => setImmediate(res))
    }
    const delta = parseFloat((currentElo - 1200).toFixed(2))
    const outcome = delta > 0 ? 'WIN' : delta < 0 ? 'LOSS' : 'DRAW'
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
        const freshModel = await db.botSkill.findUnique({ where: { id: modelId } })
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
  const model = await db.botSkill.findUnique({ where: { id: modelId } })
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
    engine.loadQTable(model.weights && typeof model.weights === 'object' ? { ...model.weights } : {})

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
  await db.botSkill.update({
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
  const model = await db.botSkill.findUnique({ where: { id: modelId } })
  if (!model) throw new Error('Model not found')

  const alg = (model.algorithm || 'Q_LEARNING').toUpperCase()

  if (alg === 'DQN') {
    const engine = new DQNEngine(model.config)
    engine.loadQTable(model.weights)
    const mark = 'X'
    const { qValues, activations } = engine.explainBoard(board, mark)
    return { activations, qValues }
  }

  if (alg === 'ALPHA_ZERO' || alg === 'AZ') {
    const engine = new AlphaZeroEngine(model.config)
    engine.loadQTable(model.weights)
    const mark = 'X'
    const { qValues, activations, value } = engine.explainBoard(board, mark)
    return { activations, qValues, value }
  }

  // Tabular engine — no network activations
  const engine = _buildEngine(model.config, alg)
  engine.loadQTable(model.weights)
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
  const models = await Promise.all(modelIds.map(id => db.botSkill.findUnique({ where: { id } })))
  const valid = models.filter(Boolean)
  if (valid.length === 0) throw new Error('No valid models found')

  const engines = valid.map(m => {
    const alg = (m.algorithm || 'Q_LEARNING').toUpperCase()
    const engine = _buildEngine(m.config, alg)
    engine.loadQTable(m.weights)
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

/**
 * Dual-emit a training event over both transports.
 *
 * `scope` is the legacy Socket.io room name (e.g. `training:abc`); `topic`
 * is the per-event suffix (e.g. `training:progress`). For SSE we publish on
 * `<scope>:<event-suffix>` so a client can subscribe to a single prefix
 * (`training:abc:`) and receive every event for that session.
 */
function _emit(scope, event, data) {
  // SSE channel name = `<scope>:<topic>` so a client can subscribe to a
  // single prefix (e.g. `training:abc:`) and receive every event for
  // that scope. Strip the leading `ml:` from the event name.
  const topic = event.startsWith('ml:') ? event.slice(3) : event
  appendToStream(`${scope}:${topic}`, data, { userId: '*' }).catch(() => {})
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
