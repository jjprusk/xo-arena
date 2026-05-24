// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// A3a.4 — Training presets per (game, algorithm).
//
// A preset bundles two things:
//   • iterations:           episode count handed to the training loop
//   • expectedDurationMs:   estimated wall-clock runtime, used for the
//                           admin-approval ETA gate (A3a.5; threshold = 4hr)
//                           and for surfacing time-to-finish in the UI.
//
// Numbers below are baselines for Tic-Tac-Toe. When Connect 4 ships, the
// `connect-four` table will land alongside (with its own algorithm sub-table)
// without changing any consumer code — the resolver looks up by gameId first.
//
// The "deep" preset for AlphaZero and DQN intentionally crosses the 4-hour
// admin-approval threshold so the gating flow gets exercised on every
// trainable game.

const HOUR_MS = 60 * 60 * 1000
const MIN_MS  = 60 * 1000

export const PRESET_NAMES = Object.freeze(['quick', 'standard', 'deep'])

export const TRAINING_PRESETS = Object.freeze({
  'tic-tac-toe': Object.freeze({
    qlearning: Object.freeze({
      // "Deep" is capped at the 100k-per-session limit. TTT is solved —
      // qlearning saturates well before 100k anyway, so the bound here is
      // policy, not capability.
      quick:    { iterations:   5_000, expectedDurationMs:  5 * MIN_MS },
      standard: { iterations:  50_000, expectedDurationMs: 30 * MIN_MS },
      deep:     { iterations: 100_000, expectedDurationMs:      HOUR_MS },
    }),
    sarsa: Object.freeze({
      quick:    { iterations:   5_000, expectedDurationMs:  5 * MIN_MS },
      standard: { iterations:  50_000, expectedDurationMs: 30 * MIN_MS },
      deep:     { iterations: 100_000, expectedDurationMs:      HOUR_MS },
    }),
    montecarlo: Object.freeze({
      quick:    { iterations:   5_000, expectedDurationMs:  5 * MIN_MS },
      standard: { iterations:  50_000, expectedDurationMs: 30 * MIN_MS },
      deep:     { iterations: 100_000, expectedDurationMs:      HOUR_MS },
    }),
    policygradient: Object.freeze({
      quick:    { iterations:   3_000, expectedDurationMs: 10 * MIN_MS },
      standard: { iterations:  30_000, expectedDurationMs:      HOUR_MS },
      deep:     { iterations: 100_000, expectedDurationMs:  4 * HOUR_MS },
    }),
    dqn: Object.freeze({
      quick:    { iterations:   2_000, expectedDurationMs: 10 * MIN_MS },
      standard: { iterations:  20_000, expectedDurationMs:      HOUR_MS },
      deep:     { iterations: 100_000, expectedDurationMs:  4 * HOUR_MS },
    }),
    alphazero: Object.freeze({
      quick:    { iterations:     500, expectedDurationMs: 30 * MIN_MS },
      standard: { iterations:   2_500, expectedDurationMs:  4 * HOUR_MS },
      deep:     { iterations:  10_000, expectedDurationMs: 24 * HOUR_MS },
    }),
    mcts: Object.freeze({
      // MCTS is mostly online — "training" tunes hyperparams via mini-runs.
      quick:    { iterations:     500, expectedDurationMs:  2 * MIN_MS },
      standard: { iterations:   2_500, expectedDurationMs: 15 * MIN_MS },
      deep:     { iterations:  10_000, expectedDurationMs:      HOUR_MS },
    }),
    rule_based: Object.freeze({
      // Rule-based has no "training" — presets are a labelling convenience
      // so the UI can speak the same vocabulary across all algorithms.
      quick:    { iterations: 0, expectedDurationMs: 0 },
      standard: { iterations: 0, expectedDurationMs: 0 },
      deep:     { iterations: 0, expectedDurationMs: 0 },
    }),
  }),
})

/**
 * Resolve a preset to its episode count + ETA, or null when the
 * (gameId, algorithm, preset) tuple is unknown.
 *
 *   resolvePreset({ gameId: 'tic-tac-toe', algorithm: 'qlearning', preset: 'quick' })
 *     → { iterations: 5000, expectedDurationMs: 300_000 }
 *
 * Algorithm matching is permissive: 'Q_LEARNING' / 'qlearning' / 'q-learning'
 * all resolve to the same table key (lowercase + strip '-_'). This mirrors
 * the existing normalisation in `userService.createBot`.
 */
export function resolvePreset({ gameId, algorithm, preset }) {
  if (!gameId || !algorithm || !preset) return null
  if (!PRESET_NAMES.includes(preset)) return null
  const gameTable = TRAINING_PRESETS[gameId]
  if (!gameTable) return null
  const algKey = String(algorithm).toLowerCase().replace(/[-_]/g, '')
  // Try the normalised form first (matches qlearning, dqn, alphazero, …)
  // then fall back to the raw value (matches the literal `rule_based` key).
  const algTable = gameTable[algKey] || gameTable[algorithm]
  if (!algTable) return null
  return algTable[preset] ?? null
}

/** Enumerate every preset available for a (gameId, algorithm) pair. */
export function listPresetsFor({ gameId, algorithm }) {
  if (!gameId || !algorithm) return []
  const gameTable = TRAINING_PRESETS[gameId]
  if (!gameTable) return []
  const algKey = String(algorithm).toLowerCase().replace(/[-_]/g, '')
  const algTable = gameTable[algKey] || gameTable[algorithm]
  if (!algTable) return []
  return PRESET_NAMES
    .filter(name => algTable[name])
    .map(name => ({ name, ...algTable[name] }))
}
