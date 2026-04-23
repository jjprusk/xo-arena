// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect } from 'vitest'
import { ALGORITHMS, normalizeAlgorithm } from '../gymShared.jsx'

// Backend persists algorithms as lowercase-no-separator
// ('qlearning', 'montecarlo', ...); the frontend compares against
// SCREAMING_SNAKE_CASE ('Q_LEARNING', 'MONTE_CARLO', ...). If these drift,
// the Gym form shows a blank algorithm label, DQN/AlphaZero config panels
// stop rendering, and buildEngine() silently falls through to QLearning for
// MonteCarlo / PolicyGradient / AlphaZero bots. This test is the tripwire.

describe('normalizeAlgorithm', () => {
  it('maps every backend lowercase-no-separator form to its ALGORITHMS entry', () => {
    const cases = [
      ['qlearning',      'Q_LEARNING'],
      ['sarsa',          'SARSA'],
      ['montecarlo',     'MONTE_CARLO'],
      ['policygradient', 'POLICY_GRADIENT'],
      ['dqn',            'DQN'],
      ['alphazero',      'ALPHA_ZERO'],
    ]
    for (const [backend, canonical] of cases) {
      expect(normalizeAlgorithm(backend)).toBe(canonical)
      // and the canonical value must exist in ALGORITHMS (the UI lookup source)
      expect(ALGORITHMS.find(a => a.value === canonical)).toBeTruthy()
    }
  })

  it('accepts legacy short forms (MC / PG / AZ)', () => {
    expect(normalizeAlgorithm('mc')).toBe('MONTE_CARLO')
    expect(normalizeAlgorithm('pg')).toBe('POLICY_GRADIENT')
    expect(normalizeAlgorithm('az')).toBe('ALPHA_ZERO')
  })

  it('accepts the canonical SCREAMING_SNAKE form itself (idempotent)', () => {
    for (const { value } of ALGORITHMS) {
      expect(normalizeAlgorithm(value)).toBe(value)
    }
  })

  it('falls back to Q_LEARNING for null / undefined / unknown', () => {
    expect(normalizeAlgorithm(null)).toBe('Q_LEARNING')
    expect(normalizeAlgorithm(undefined)).toBe('Q_LEARNING')
    expect(normalizeAlgorithm('')).toBe('Q_LEARNING')
    expect(normalizeAlgorithm('bogus')).toBe('Q_LEARNING')
  })
})
