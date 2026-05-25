// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Connect Four botInterface — implements the BotInterface contract from
 * `@callidity/sdk`. Strict SDK conformance — no platform-specific shims.
 *
 *   makeMove           — called server-side by the platform bot dispatcher
 *   getTrainingConfig  — read once when the Gym tab opens
 *   train              — runs in the platform training worker (B4 will
 *                        provide the real per-algorithm engines; this
 *                        commit ships hook stubs that throw clearly so
 *                        downstream wiring fails loud rather than silent)
 *   serializeState     — pass-through to our serializer.js for replay
 *   deserializeMove    — column index normalizer
 *   personas           — re-exports meta.builtInBots
 *
 * The minimax Master tier in B1.5 uses depth 6 as a placeholder; B1.6
 * replaces it with `master.bestMove()` (full-depth perfect play).
 */

import { meta }                                      from './meta.js'
import { getLegalMoves, MARKS }                      from './logic.js'
import { bestMove, DIFFICULTY_DEPTH }                from './minimax.js'
import { bestMove as masterBestMove }                from './master.js'
import { serializeState as _serState }               from './serializer.js'

const Y = MARKS.FIRST

/**
 * Choose a move for the given state. Synchronous, stateless, called
 * server-side by the platform bot dispatcher.
 *
 * The platform passes the game's own state representation through — for
 * Connect Four that's `{ board, currentTurn }` or a bare board array.
 * We normalize both shapes.
 *
 * Dispatches on `persona.algorithm` (the SDK already calls out that
 * `persona.id` will be retired in favor of `algorithm + difficulty` for
 * custom personas — start on the right foot).
 */
function makeMove(state, playerId, persona, weights) {
  const board = Array.isArray(state) ? state : state?.board
  if (!Array.isArray(board)) {
    throw new Error('connect-four makeMove: missing board in state')
  }

  // Which mark does this bot hold? The platform sets a marks map on the
  // session settings; fall back to the position's "to move" if it doesn't.
  const mark = state?.marks?.[playerId] ?? state?.currentTurn ?? Y
  const legal = getLegalMoves(board)
  if (legal.length === 0) return -1

  if (persona.algorithm === 'minimax') {
    // Master tier routes to the dedicated solver in master.js — iterative
    // deepening + transposition table + threat-parity heuristic. The
    // depth-based DIFFICULTY_DEPTH mapping in minimax.js stops at 'hard';
    // master is qualitatively different and lives in its own module.
    const col = persona.difficulty === 'master'
      ? masterBestMove(board, mark)
      : bestMove(board, mark, DIFFICULTY_DEPTH[persona.difficulty] ?? DIFFICULTY_DEPTH.medium)
    // Defensive: if the search returns an out-of-bounds column for any
    // reason (degenerate eval, future bug), fall back to the most
    // central legal column so the bot still plays a legal move.
    if (col < 0 || !legal.includes(col)) {
      return legal.includes(3) ? 3
        : legal.includes(2) ? 2
        : legal.includes(4) ? 4
        : legal[0]
    }
    return col
  }

  // ML algorithms (qlearning, sarsa, dqn, alphazero, montecarlo,
  // policygradient) — without weights, fall back to a random legal move
  // the same way XO does. Real per-algorithm dispatch lands in B4 once
  // `@xo-arena/ai` is extended for C4's 42-cell state + 7-col action
  // space.
  if (!weights) {
    return legal[Math.floor(Math.random() * legal.length)]
  }

  // With weights but no per-algorithm engine yet, still fall back rather
  // than throw — the platform's bot loop must not crash on a configured
  // persona. The training-side path (B4) will replace this branch.
  return legal[Math.floor(Math.random() * legal.length)]
}

/**
 * Training configuration shown in the Gym UI. Hyperparameter set mirrors
 * the XO surface so users moving between games see a familiar layout;
 * algorithm-specific defaults differ where C4's state space (42 cells
 * vs 9) suggests a different starting point — most notably the larger
 * default episode count.
 */
function getTrainingConfig() {
  return {
    algorithm:       'qlearning',
    defaultEpisodes: 20_000, // ~4× XO — bigger state space needs more samples
    hyperparameters: {
      algorithm: {
        label:   'Algorithm',
        type:    'select',
        default: 'qlearning',
        options: [
          { value: 'qlearning',      label: 'Q-Learning' },
          { value: 'sarsa',          label: 'SARSA' },
          { value: 'montecarlo',     label: 'Monte Carlo' },
          { value: 'policygradient', label: 'Policy Gradient' },
          { value: 'dqn',            label: 'DQN (Deep Q-Network)' },
          { value: 'alphazero',      label: 'AlphaZero' },
        ],
        description: 'Training algorithm. Tabular methods (Q-Learning, SARSA) are fast to start. DQN and AlphaZero scale to deeper play but train slower.',
      },
      learningRate: {
        label:   'Learning Rate',
        type:    'number',
        default: 0.2,
        min:     0.01,
        max:     1.0,
        step:    0.01,
        description: 'How aggressively new experience overwrites prior estimates. Lower than TTT defaults because C4 episodes contain more moves.',
      },
      discountFactor: {
        label:   'Discount Factor',
        type:    'number',
        default: 0.95,
        min:     0.5,
        max:     1.0,
        step:    0.01,
        description: 'How much future rewards matter. Higher because C4 wins are typically several moves away from the decisive threat.',
      },
      epsilonStart: {
        label:   'Epsilon Start',
        type:    'number',
        default: 1.0,
        min:     0.1,
        max:     1.0,
        step:    0.05,
      },
      epsilonMin: {
        label:   'Epsilon Min',
        type:    'number',
        default: 0.05,
        min:     0.0,
        max:     0.5,
        step:    0.01,
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
      },
    },
  }
}

/**
 * Stub training implementation — B4 will replace this with real per-
 * algorithm dispatch once `@xo-arena/ai` engines are extended for C4's
 * 42-cell state + 7-column action space. Throwing here (rather than
 * silently returning empty weights) makes any premature wiring of the
 * Gym surface for C4 fail loud during testing.
 *
 * Signature still matches BotInterface.train so the contract type-checks.
 */
async function train(/* run, currentWeights, onProgress */) {
  throw new Error('connect-four.botInterface.train is not implemented yet (lands in B4)')
}

/**
 * Pass-through serializer using the package's own format. Replays store
 * exactly what `serializeState` produces; the platform never inspects
 * the contents.
 */
function serializeState(state) {
  return _serState(state)
}

/**
 * Normalize a raw stored move (from replay storage or wire transport)
 * back to a column index. Accepts numbers and numeric strings. Anything
 * else throws — moves should be column indices 0..6, period.
 */
function deserializeMove(raw) {
  let n
  if (typeof raw === 'number') {
    n = raw
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    // Accept '3', ' 3 ', etc. Reject empty/whitespace because Number('') === 0
    // which would otherwise pass the range check as a bogus col 0 move.
    n = Number(raw)
  } else {
    // null, undefined, objects, booleans — anything else is not a move.
    throw new Error(`connect-four deserializeMove: not a valid column index: ${JSON.stringify(raw)}`)
  }
  if (!Number.isInteger(n) || n < 0 || n > 6) {
    throw new Error(`connect-four deserializeMove: not a valid column index: ${JSON.stringify(raw)}`)
  }
  return n
}

/** @type {import('@callidity/sdk').BotInterface} */
export const botInterface = {
  makeMove,
  getTrainingConfig,
  train,
  serializeState,
  deserializeMove,
  personas: meta.builtInBots,
  // GymComponent + puzzles land in later sprints — B1's botInterface is
  // headless. The SDK contract marks those as optional so this is valid.
}
