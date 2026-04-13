// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO botInterface — implements the BotInterface contract from @callidity/sdk.
 *
 * makeMove is called server-side by the platform bot dispatcher.
 * train is called server-side by the platform training worker.
 * GymComponent and puzzles are rendered in the platform shell tabs.
 */

import {
  minimaxImplementation,
  QLearningEngine,
  SarsaEngine,
  DQNEngine,
  MonteCarloEngine,
  PolicyGradientEngine,
  AlphaZeroEngine,
  runEpisode,
  getEmptyCells,
  ruleBasedMove,
} from '@xo-arena/ai'

import { meta } from './meta.js'
import { serializeState, deserializeMove, getLegalMoves } from './adapters.js'
import { GymComponent } from './GymComponent.jsx'
import { puzzles } from './puzzles.js'

// ── makeMove ─────────────────────────────────────────────────────────────────

/**
 * Choose a move for the given state.
 * Synchronous, stateless, called server-side.
 *
 * Dispatches on persona.id for now (migrate to persona.algorithm when custom
 * personas land — see SDK contract note in BotInterface.makeMove).
 */
function makeMove(state, playerId, persona, weights) {
  const board  = Array.isArray(state) ? state : state.board
  const mark   = state.marks?.[playerId] ?? state.currentTurn ?? 'X'
  const empty  = getEmptyCells(board)
  if (empty.length === 0) return -1

  // Minimax personas
  if (persona.algorithm === 'minimax') {
    const diffMap = { beginner: 'novice', easy: 'novice', medium: 'intermediate', hard: 'advanced', expert: 'master' }
    const diff = diffMap[persona.difficulty] ?? 'intermediate'
    return minimaxImplementation.move(board, diff, mark)
  }

  // Rule-based — weights.rules is pre-loaded by the platform bot dispatcher
  // (dispatcher resolves persona.ruleSetId → rules array before calling makeMove)
  if (persona.algorithm === 'rule_based') {
    const rules = weights?.rules ?? []
    return ruleBasedMove(board, mark, rules)
  }

  // Q-Learning
  if (persona.algorithm === 'qlearning') {
    if (!weights) return empty[Math.floor(Math.random() * empty.length)]
    const engine = new QLearningEngine()
    engine.loadQTable(weights)
    return engine.chooseAction(board, false)
  }

  // SARSA
  if (persona.algorithm === 'sarsa') {
    if (!weights) return empty[Math.floor(Math.random() * empty.length)]
    const engine = new SarsaEngine()
    engine.loadQTable(weights)
    return engine.chooseAction(board, false)
  }

  // DQN
  if (persona.algorithm === 'dqn') {
    if (!weights) return empty[Math.floor(Math.random() * empty.length)]
    const engine = new DQNEngine({ stateSize: 9, actionSize: 9 })
    engine.loadWeights(weights)
    const stateVec = serializeState(board, mark)
    const qVals = engine.predict(stateVec)
    return empty.reduce((best, idx) => qVals[idx] > qVals[best] ? idx : best, empty[0])
  }

  // AlphaZero
  if (persona.algorithm === 'alphazero') {
    if (!weights) return empty[Math.floor(Math.random() * empty.length)]
    const engine = new AlphaZeroEngine({ stateSize: 9, actionSize: 9 })
    engine.loadWeights(weights)
    const stateVec = serializeState(board, mark)
    return engine.selectAction(stateVec, empty)
  }

  // Fallback — random legal move
  return empty[Math.floor(Math.random() * empty.length)]
}

// ── getTrainingConfig ────────────────────────────────────────────────────────

function getTrainingConfig() {
  return {
    algorithm:       'qlearning',
    defaultEpisodes: 5000,
    hyperparameters: {
      algorithm: {
        label:   'Algorithm',
        type:    'select',
        default: 'qlearning',
        options: [
          { value: 'qlearning',      label: 'Q-Learning' },
          { value: 'sarsa',          label: 'SARSA' },
          { value: 'dqn',            label: 'Deep Q-Network (DQN)' },
          { value: 'montecarlo',     label: 'Monte Carlo' },
          { value: 'policygradient', label: 'Policy Gradient' },
          { value: 'alphazero',      label: 'AlphaZero' },
        ],
        description: 'Training algorithm. Q-Learning and SARSA are fast. DQN and AlphaZero are more powerful but slower.',
      },
      learningRate: {
        label:   'Learning Rate',
        type:    'number',
        default: 0.3,
        min:     0.01,
        max:     1.0,
        step:    0.01,
        description: 'How much new information overwrites old. Higher = learns faster but less stable.',
      },
      discountFactor: {
        label:   'Discount Factor',
        type:    'number',
        default: 0.9,
        min:     0.5,
        max:     1.0,
        step:    0.01,
        description: 'How much future rewards are valued. 1.0 = fully long-term, 0.5 = short-sighted.',
      },
      epsilonStart: {
        label:   'Epsilon Start',
        type:    'number',
        default: 1.0,
        min:     0.1,
        max:     1.0,
        step:    0.05,
        description: 'Initial exploration rate. 1.0 = fully random at start.',
      },
      epsilonMin: {
        label:   'Epsilon Min',
        type:    'number',
        default: 0.05,
        min:     0.0,
        max:     0.5,
        step:    0.01,
        description: 'Minimum exploration rate. Bot always explores at least this much.',
      },
      decayMethod: {
        label:   'Epsilon Decay',
        type:    'select',
        default: 'exponential',
        options: [
          { value: 'exponential', label: 'Exponential' },
          { value: 'linear',      label: 'Linear' },
          { value: 'cosine',      label: 'Cosine' },
        ],
        description: 'How exploration rate decreases over episodes.',
      },
    },
  }
}

// ── train ────────────────────────────────────────────────────────────────────

async function train(run, currentWeights, onProgress) {
  const { episodes, params } = run
  const algo = params.algorithm ?? run.algorithm ?? 'qlearning'

  let engine

  if (algo === 'qlearning') {
    engine = new QLearningEngine({
      learningRate:   params.learningRate   ?? 0.3,
      discountFactor: params.discountFactor ?? 0.9,
      epsilonStart:   params.epsilonStart   ?? 1.0,
      epsilonMin:     params.epsilonMin     ?? 0.05,
      decayMethod:    params.decayMethod    ?? 'exponential',
      totalEpisodes:  episodes,
    })
    if (currentWeights) engine.loadQTable(currentWeights)
  } else if (algo === 'sarsa') {
    engine = new SarsaEngine({
      learningRate:   params.learningRate   ?? 0.3,
      discountFactor: params.discountFactor ?? 0.9,
      epsilonStart:   params.epsilonStart   ?? 1.0,
      epsilonMin:     params.epsilonMin     ?? 0.05,
      decayMethod:    params.decayMethod    ?? 'exponential',
      totalEpisodes:  episodes,
    })
    if (currentWeights) engine.loadQTable(currentWeights)
  } else {
    // DQN, AlphaZero, Monte Carlo, Policy Gradient — fall back to Q-Learning for now
    // Full implementations added per-algorithm as needed
    engine = new QLearningEngine({ totalEpisodes: episodes })
    if (currentWeights) engine.loadQTable(currentWeights)
  }

  let wins = 0, losses = 0, draws = 0
  const progressInterval = Math.max(1, Math.floor(episodes / 100))

  for (let i = 1; i <= episodes; i++) {
    const result = runEpisode(engine, 'both', null)
    if (result.outcome === 'WIN')  wins++
    if (result.outcome === 'LOSS') losses++
    if (result.outcome === 'DRAW') draws++

    if (i % progressInterval === 0 || i === episodes) {
      onProgress({
        episode:       i,
        totalEpisodes: episodes,
        outcome:       result.outcome,
        epsilon:       engine.epsilon,
        avgQDelta:     result.avgQDelta,
      })
      // Yield to event loop to avoid blocking
      await new Promise(r => setTimeout(r, 0))
    }
  }

  return {
    episodesCompleted: episodes,
    winRate:           wins   / episodes,
    lossRate:          losses / episodes,
    drawRate:          draws  / episodes,
    finalEpsilon:      engine.epsilon,
    weights:           engine.toJSON(),
  }
}

// ── BotInterface export ───────────────────────────────────────────────────────

/** @type {import('@callidity/sdk').BotInterface} */
export const botInterface = {
  makeMove,
  getTrainingConfig,
  train,
  serializeState,
  deserializeMove,
  personas: meta.builtInBots,
  GymComponent,
  puzzles,
}
