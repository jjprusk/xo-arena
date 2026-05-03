// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { skillCategory, gameLabel } from '../skillCategory.js'

// Phase 3.8.B.2 — these helpers gate which Gym detail-panel view renders for
// a given BotSkill. Lock the algorithm-key → category mapping so renaming an
// algorithm value or adding a new one (Phase 4: Connect4 algorithms) is a
// deliberate test-list update rather than a silent UI regression.

describe('skillCategory', () => {
  it('groups deterministic algorithms under "minimax"', () => {
    expect(skillCategory('minimax')).toBe('minimax')
    expect(skillCategory('mcts')).toBe('minimax')
  })

  it('groups RL/NN algorithms under "ml"', () => {
    for (const algo of ['qlearning', 'sarsa', 'montecarlo', 'policygradient', 'dqn', 'alphazero']) {
      expect(skillCategory(algo)).toBe('ml')
    }
  })

  it('returns null for empty/missing algorithm so the panel stays in the "pick a skill" state', () => {
    expect(skillCategory(null)).toBeNull()
    expect(skillCategory(undefined)).toBeNull()
    expect(skillCategory('')).toBeNull()
  })

  it('returns "other" for unrecognized algorithms so the panel can show a graceful fallback rather than crash', () => {
    expect(skillCategory('whatever')).toBe('other')
  })
})

describe('gameLabel', () => {
  it('returns the registry label for a known gameId', () => {
    // 'xo' is the only registered game today; if the registry renames it,
    // this test fails loudly so the upgrader notices the dependent UI strings.
    expect(gameLabel('xo')).toMatch(/xo|tic-?tac-?toe/i)
  })

  it('falls back to the upper-cased gameId for an unknown gameId', () => {
    expect(gameLabel('connect4')).toBe('CONNECT4')
  })

  it('handles null/empty gameId without throwing', () => {
    expect(gameLabel(null)).toBe('')
    expect(gameLabel('')).toBe('')
  })
})
