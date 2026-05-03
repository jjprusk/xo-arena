// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { GAMES } from './gameRegistry.js'

// Phase 3.8 — Multi-Skill Bots. The legacy `User.botModelType` collapsed into
// 'ml' | 'minimax' | 'mcts' | 'rule_based'; per-skill we work off the raw
// algorithm key (qlearning, dqn, minimax, …). Group them so the Gym detail
// panel can pick the right view (read-only minimax card vs full ML training
// tabs) without leaking the algorithm enumeration into a chain of
// conditionals.
const MINIMAX_ALGORITHMS = new Set(['minimax', 'mcts'])
const ML_ALGORITHMS      = new Set(['qlearning', 'sarsa', 'montecarlo', 'policygradient', 'dqn', 'alphazero'])

export function skillCategory(algorithm) {
  if (!algorithm) return null
  if (MINIMAX_ALGORITHMS.has(algorithm)) return 'minimax'
  if (ML_ALGORITHMS.has(algorithm)) return 'ml'
  return 'other'
}

export function gameLabel(gameId) {
  return GAMES.find(g => g.id === gameId)?.label ?? (gameId || '').toUpperCase()
}
