/**
 * Frontend training service — runs ML training episodes in the browser.
 *
 * Uses the same @xo-arena/ai engines as the backend. The training loop yields
 * the event loop via setTimeout so the UI stays responsive. Progress is
 * delivered via callbacks (no WebSocket needed).
 */

import {
  QLearningEngine, runEpisode,
  SarsaEngine,
  MonteCarloEngine,
  PolicyGradientEngine,
  DQNEngine,
  AlphaZeroEngine,
  minimaxMove,
  getWinner, isBoardFull, opponent,
} from '@xo-arena/ai'

// ─── Engine builder ──────────────────────────────────────────────────────────

export function buildEngine(model, sessionConfig = {}) {
  const algorithm = (sessionConfig.algorithm || model.algorithm || 'Q_LEARNING').toUpperCase()
  let engineConfig = { ...model.config, ...sessionConfig, totalEpisodes: sessionConfig.iterations || 1000 }
  let qtable = model.qtable || {}

  // DQN: reset weights if architecture changed (mirrors backend logic)
  if (algorithm === 'DQN') {
    const requestedShape = sessionConfig.networkShape ??
      (sessionConfig.hiddenSize != null ? [sessionConfig.hiddenSize] : null)
    if (requestedShape) {
      const requestedLayerSizes = [9, ...requestedShape.map(Number), 9]
      engineConfig = { ...engineConfig, layerSizes: requestedLayerSizes, networkShape: requestedShape.map(Number) }
      const storedLayerSizes = model.config?.layerSizes ?? [9, 32, 9]
      if (JSON.stringify(requestedLayerSizes) !== JSON.stringify(storedLayerSizes)) {
        qtable = {}
      }
    }
  }

  let engine
  if (algorithm === 'SARSA')                       engine = new SarsaEngine(engineConfig)
  else if (algorithm === 'MONTE_CARLO' || algorithm === 'MC') engine = new MonteCarloEngine(engineConfig)
  else if (algorithm === 'POLICY_GRADIENT' || algorithm === 'PG') engine = new PolicyGradientEngine(engineConfig)
  else if (algorithm === 'DQN')                    engine = new DQNEngine(engineConfig)
  else if (algorithm === 'ALPHA_ZERO' || algorithm === 'AZ') engine = new AlphaZeroEngine(engineConfig)
  else                                              engine = new QLearningEngine(engineConfig)

  engine.loadQTable(qtable)
  return engine
}

// ─── Episode runners ─────────────────────────────────────────────────────────
// Ported 1-to-1 from backend/src/services/mlService.js

function _encodeStateForDQN(board, mark) {
  const opp = mark === 'X' ? 'O' : 'X'
  return board.map(c => c === mark ? 1 : c === opp ? -1 : 0)
}

function _dqnShapeReward(prevBoard, board, action, mark) {
  let bonus = 0
  const opp = mark === 'X' ? 'O' : 'X'
  for (let i = 0; i < 9; i++) {
    if (prevBoard[i] !== null) continue
    const test = [...prevBoard]; test[i] = opp
    if (getWinner(test) === opp) {
      if (i === action) { bonus += 0.3; break }
    }
  }
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue
    const test = [...board]; test[i] = mark
    if (getWinner(test) === mark) { bonus += 0.1; break }
  }
  return bonus
}

function _runDQNEpisode(engine, opponentFn, mlMark) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0
  const lastMLExp = {}

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
      reward = winner
        ? (winner === (mlMark === 'both' ? currentPlayer : mlMark) ? 1.0 : -1.0)
        : 0.5
    } else if (isML) {
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
      if (isDraw) outcome = 'DRAW'
      else if (mlMark === 'both') outcome = winner === 'X' ? 'WIN' : 'LOSS'
      else outcome = winner === mlMark ? 'WIN' : 'LOSS'
      return { outcome, totalMoves, avgQDelta: 0, epsilon: engine.epsilon }
    }

    currentPlayer = opponent(currentPlayer)
  }
}

function _runAlphaZeroEpisode(engine) {
  const result = engine.runEpisode()
  return { outcome: result.outcome || 'DRAW', totalMoves: result.totalMoves || 9, avgQDelta: 0, epsilon: 0 }
}

function _runSarsaEpisode(engine, mlMark, opponentFn) {
  const board = Array(9).fill(null)
  let currentPlayer = 'X'
  let totalMoves = 0
  let totalQDelta = 0, qdeltaCount = 0
  const history = { X: [], O: [] }

  while (true) {
    const isML = mlMark === 'both' || currentPlayer === mlMark
    const action = isML ? engine.chooseAction(board, true) : opponentFn(board, currentPlayer)
    const prevBoard = [...board]
    board[action] = currentPlayer
    totalMoves++
    history[currentPlayer].push({ board: prevBoard, action })

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const rewards = winner === 'X' ? { X: 1.0, O: -1.0 }
        : winner === 'O'           ? { X: -1.0, O: 1.0 }
        :                            { X: 0.5, O: 0.5 }

      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]
      for (const mark of marksToUpdate) {
        const steps = history[mark]
        for (let t = 0; t < steps.length; t++) {
          const { board: s, action: a } = steps[t]
          const isLast = t === steps.length - 1
          const nextAction = isLast ? -1 : steps[t + 1].action
          const nextBoard  = isLast ? board : steps[t + 1].board
          const delta = engine.update(s, a, isLast ? rewards[mark] : 0, nextBoard, nextAction, isLast)
          totalQDelta += delta; qdeltaCount++
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

function _runMCEpisode(engine, mlMark, opponentFn) {
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
      trajectories[currentPlayer].push({ board: prevBoard, action })
    } else {
      action = opponentFn(board, currentPlayer)
    }
    board[action] = currentPlayer; totalMoves++

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const rewards = winner === 'X' ? { X: 1.0, O: -1.0 }
        : winner === 'O'           ? { X: -1.0, O: 1.0 }
        :                            { X: 0.5, O: 0.5 }
      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]
      let totalDelta = 0, count = 0
      for (const mark of marksToUpdate) {
        engine._trajectory = trajectories[mark]
        totalDelta += engine.finishEpisode(rewards[mark]); count++
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
    board[action] = currentPlayer; totalMoves++

    const winner = getWinner(board)
    const isDraw = !winner && isBoardFull(board)

    if (winner || isDraw) {
      const rewards = winner === 'X' ? { X: 1.0, O: -1.0 }
        : winner === 'O'           ? { X: -1.0, O: 1.0 }
        :                            { X: 0.5, O: 0.5 }
      const marksToUpdate = mlMark === 'both' ? ['X', 'O'] : [mlMark]
      let totalDelta = 0, count = 0
      for (const mark of marksToUpdate) {
        engine._trajectory = trajectories[mark]
        totalDelta += engine.finishEpisode(rewards[mark]); count++
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

function _runEpisodeForAlgorithm(engine, mlMark, opponentFn, algorithm) {
  const alg = (algorithm || 'Q_LEARNING').toUpperCase()
  if (alg === 'SARSA')                             return _runSarsaEpisode(engine, mlMark, opponentFn)
  if (alg === 'MONTE_CARLO' || alg === 'MC')       return _runMCEpisode(engine, mlMark, opponentFn)
  if (alg === 'POLICY_GRADIENT' || alg === 'PG')   return _runPGEpisode(engine, mlMark, opponentFn)
  if (alg === 'DQN')                               return _runDQNEpisode(engine, opponentFn, mlMark)
  if (alg === 'ALPHA_ZERO' || alg === 'AZ')        return _runAlphaZeroEpisode(engine)
  return runEpisode(engine, mlMark, opponentFn)
}

const CURRICULUM_LEVELS = ['novice', 'intermediate', 'advanced', 'master']
const PROGRESS_BATCH = 50  // minimum episodes between progress events

// ─── Main training orchestrator ─────────────────────────────────────────────

/**
 * Run a frontend training session in the browser.
 *
 * @param {Object} opts
 * @param {Object} opts.model   — { config, qtable, algorithm } from startFrontendSession
 * @param {Object} opts.session — { id, mode, iterations, config } from startFrontendSession
 * @param {Function} [opts.onProgress]          — called with progress data each batch
 * @param {Function} [opts.onCurriculumAdvance] — called when curriculum level advances
 * @param {Object}  [opts.cancelRef]            — { current: boolean } — set to true to stop
 * @returns {Promise<{ weights, stats, iterations, status }>}
 */
export async function runTrainingSession({ model, session, onProgress, onCurriculumAdvance, cancelRef }) {
  const { mode, iterations, config = {} } = session
  const algorithm = config.algorithm || model.algorithm || 'Q_LEARNING'

  const engine = buildEngine(model, { ...config, iterations })

  let difficulty = config.difficulty || 'novice'
  let curriculumLevel = Math.max(0, CURRICULUM_LEVELS.indexOf(difficulty))
  const opponentFn = mode === 'VS_MINIMAX'
    ? (board, player) => minimaxMove(board, difficulty, player)
    : null

  const mlMarkConfig = mode === 'SELF_PLAY' ? 'both' : (config.mlMark || 'alternating')
  let mlMark = mlMarkConfig === 'alternating' ? 'X' : mlMarkConfig

  const earlyStop = config.earlyStop || null
  let bestWinRate = 0
  let episodesWithoutImprovement = 0

  const CURRICULUM_WINDOW = 100
  const outcomeWindow = []

  const PROGRESS_INTERVAL = Math.max(PROGRESS_BATCH, Math.floor(iterations / 20))

  let wins = 0, losses = 0, draws = 0, totalQDelta = 0
  let actualEpisodes = 0

  for (let i = 0; i < iterations; i++) {
    if (cancelRef?.current) {
      return {
        weights:    engine.toJSON(),
        stats:      { wins, losses, draws, totalQDelta, finalEpsilon: engine.epsilon, stateCount: engine.stateCount },
        iterations: actualEpisodes,
        status:     'CANCELLED',
      }
    }

    const result = _runEpisodeForAlgorithm(engine, mlMark, opponentFn, algorithm)
    actualEpisodes++
    if (mlMarkConfig === 'alternating') mlMark = mlMark === 'X' ? 'O' : 'X'

    if (result.outcome === 'WIN')       wins++
    else if (result.outcome === 'LOSS') losses++
    else                                draws++
    totalQDelta += result.avgQDelta

    // Curriculum learning
    if (config.curriculum && mode === 'VS_MINIMAX') {
      outcomeWindow.push(result.outcome === 'WIN' ? 1 : 0)
      if (outcomeWindow.length > CURRICULUM_WINDOW) outcomeWindow.shift()
      if (outcomeWindow.length === CURRICULUM_WINDOW) {
        const winRate = outcomeWindow.reduce((s, v) => s + v, 0) / CURRICULUM_WINDOW
        if (winRate > 0.65 && curriculumLevel < CURRICULUM_LEVELS.length - 1) {
          curriculumLevel++
          difficulty = CURRICULUM_LEVELS[curriculumLevel]
          outcomeWindow.length = 0
          onCurriculumAdvance?.({ difficulty, episode: i + 1 })
        }
      }
    }

    // Early stopping check
    if (earlyStop && (i + 1) % PROGRESS_INTERVAL === 0) {
      const currentWinRate = wins / (i + 1)
      if (currentWinRate > bestWinRate + (earlyStop.minDelta ?? 0.01)) {
        bestWinRate = currentWinRate
        episodesWithoutImprovement = 0
      } else {
        episodesWithoutImprovement += PROGRESS_INTERVAL
      }
      if (episodesWithoutImprovement >= (earlyStop.patience ?? 200)) {
        onProgress?.({
          episode: i + 1, totalEpisodes: iterations,
          winRate:  wins / (i + 1), lossRate: losses / (i + 1), drawRate: draws / (i + 1),
          avgQDelta: totalQDelta / (i + 1), epsilon: engine.epsilon,
          outcomes: { wins, losses, draws }, earlyStop: true,
        })
        return {
          weights:    engine.toJSON(),
          stats:      { wins, losses, draws, totalQDelta, finalEpsilon: engine.epsilon, stateCount: engine.stateCount },
          iterations: actualEpisodes,
          status:     'COMPLETED',
        }
      }
    }

    // Progress update + event-loop yield
    if ((i + 1) % PROGRESS_INTERVAL === 0 || i === iterations - 1) {
      const done = i + 1
      onProgress?.({
        episode: done, totalEpisodes: iterations,
        winRate:  done > 0 ? wins   / done : 0,
        lossRate: done > 0 ? losses / done : 0,
        drawRate: done > 0 ? draws  / done : 0,
        avgQDelta: done > 0 ? totalQDelta / done : 0,
        epsilon: engine.epsilon,
        outcomes: { wins, losses, draws },
      })
      // Yield to the event loop so React can re-render
      await new Promise(r => setTimeout(r, 0))
    }
  }

  return {
    weights:    engine.toJSON(),
    stats:      { wins, losses, draws, totalQDelta, finalEpsilon: engine.epsilon, stateCount: engine.stateCount },
    iterations: actualEpisodes,
    status:     'COMPLETED',
  }
}
