// A3a.4 — preset resolver contract tests.

import { describe, it, expect } from 'vitest'
import {
  PRESET_NAMES,
  TRAINING_PRESETS,
  resolvePreset,
  listPresetsFor,
} from '../trainingPresets.js'

describe('PRESET_NAMES', () => {
  it('exposes exactly three presets in canonical order', () => {
    expect(PRESET_NAMES).toEqual(['quick', 'standard', 'deep'])
  })
})

describe('TRAINING_PRESETS catalog', () => {
  it('covers every trainable TTT algorithm', () => {
    const ttt = TRAINING_PRESETS['tic-tac-toe']
    expect(Object.keys(ttt).sort()).toEqual([
      'alphazero',
      'dqn',
      'mcts',
      'montecarlo',
      'policygradient',
      'qlearning',
      'rule_based',
      'sarsa',
    ])
  })

  it('every (algorithm, preset) entry has both iterations and expectedDurationMs', () => {
    const ttt = TRAINING_PRESETS['tic-tac-toe']
    for (const [alg, table] of Object.entries(ttt)) {
      for (const preset of PRESET_NAMES) {
        const entry = table[preset]
        expect(entry, `${alg}/${preset} should exist`).toBeDefined()
        expect(typeof entry.iterations).toBe('number')
        expect(typeof entry.expectedDurationMs).toBe('number')
      }
    }
  })

  it('iterations strictly increase quick → standard → deep for each algorithm', () => {
    const ttt = TRAINING_PRESETS['tic-tac-toe']
    for (const [alg, table] of Object.entries(ttt)) {
      if (alg === 'rule_based') continue  // all zero by design
      expect(table.quick.iterations,    `${alg} quick < standard`).toBeLessThan(table.standard.iterations)
      expect(table.standard.iterations, `${alg} standard < deep`).toBeLessThan(table.deep.iterations)
    }
  })

  it('AlphaZero standard and DQN deep both cross the 4-hour gating threshold', () => {
    // A3a.5 will gate at >= 4hr. Ensure these obvious candidates trip it.
    const FOUR_HR = 4 * 60 * 60 * 1000
    expect(TRAINING_PRESETS['tic-tac-toe'].alphazero.standard.expectedDurationMs).toBeGreaterThanOrEqual(FOUR_HR)
    expect(TRAINING_PRESETS['tic-tac-toe'].alphazero.deep.expectedDurationMs).toBeGreaterThanOrEqual(FOUR_HR)
    expect(TRAINING_PRESETS['tic-tac-toe'].dqn.deep.expectedDurationMs).toBeGreaterThanOrEqual(FOUR_HR)
  })
})

describe('resolvePreset', () => {
  it('returns iterations + expectedDurationMs for a known (game, algorithm, preset)', () => {
    expect(resolvePreset({ gameId: 'tic-tac-toe', algorithm: 'qlearning', preset: 'quick' }))
      .toEqual({ iterations: 5_000, expectedDurationMs: 5 * 60 * 1000 })
  })

  it('normalises algorithm casing + delimiters (Q_LEARNING → qlearning)', () => {
    const a = resolvePreset({ gameId: 'tic-tac-toe', algorithm: 'qlearning',  preset: 'standard' })
    const b = resolvePreset({ gameId: 'tic-tac-toe', algorithm: 'Q_LEARNING', preset: 'standard' })
    const c = resolvePreset({ gameId: 'tic-tac-toe', algorithm: 'q-learning', preset: 'standard' })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('matches the literal rule_based key with the underscore preserved', () => {
    expect(resolvePreset({ gameId: 'tic-tac-toe', algorithm: 'rule_based', preset: 'quick' }))
      .toEqual({ iterations: 0, expectedDurationMs: 0 })
  })

  it('returns null for unknown game, algorithm, or preset', () => {
    expect(resolvePreset({ gameId: 'connect-four', algorithm: 'qlearning', preset: 'quick' })).toBeNull()
    expect(resolvePreset({ gameId: 'tic-tac-toe',  algorithm: 'banana',    preset: 'quick' })).toBeNull()
    expect(resolvePreset({ gameId: 'tic-tac-toe',  algorithm: 'qlearning', preset: 'epic'  })).toBeNull()
  })

  it('returns null for any missing parameter', () => {
    expect(resolvePreset({})).toBeNull()
    expect(resolvePreset({ gameId: 'tic-tac-toe' })).toBeNull()
    expect(resolvePreset({ algorithm: 'qlearning' })).toBeNull()
    expect(resolvePreset({ preset: 'quick' })).toBeNull()
  })
})

describe('listPresetsFor', () => {
  it('returns three preset entries with names for a known (game, algorithm)', () => {
    const result = listPresetsFor({ gameId: 'tic-tac-toe', algorithm: 'qlearning' })
    expect(result.map(r => r.name)).toEqual(['quick', 'standard', 'deep'])
    expect(result[0]).toMatchObject({ name: 'quick', iterations: 5_000 })
  })

  it('returns an empty array for unknown (game, algorithm)', () => {
    expect(listPresetsFor({ gameId: 'connect-four', algorithm: 'qlearning' })).toEqual([])
    expect(listPresetsFor({ gameId: 'tic-tac-toe',  algorithm: 'banana'    })).toEqual([])
  })
})
