// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.10 — resolveTrainingRuntime contract.
 *
 * The resolver is consulted by mlService.startTraining and by the new
 * GET /ml/runtime endpoint. Both rely on it never throwing on
 * misconfigured SystemConfig (an admin's typo can't take down the
 * dispatch path). Tests cover: matrix precedence, algorithm
 * normalization, garbage-cell fallthrough, legacy useWorker fallback,
 * and the code-default safety net.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveTrainingRuntime, DEFAULT_MATRIX } from '../trainingRuntime.js'

function mockGetConfig(values) {
  return vi.fn((key, fallback) => Promise.resolve(values[key] ?? fallback ?? null))
}

describe('resolveTrainingRuntime — matrix lookup', () => {
  it('returns the exact (gameId, algorithm) cell when set', async () => {
    const getConfig = mockGetConfig({
      'ml.runtimeMatrix': {
        'tic-tac-toe': { qlearning: 'frontend', dqn: 'worker' },
      },
    })
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning', { getConfig })).toBe('frontend')
    expect(await resolveTrainingRuntime('tic-tac-toe', 'dqn',       { getConfig })).toBe('worker')
  })

  it('falls back to the game-level default when no exact algo match', async () => {
    const getConfig = mockGetConfig({
      'ml.runtimeMatrix': {
        'connect-four': { default: 'worker' },
      },
    })
    expect(await resolveTrainingRuntime('connect-four', 'unheard-of-algo', { getConfig })).toBe('worker')
  })

  it('falls back to the global default when neither game nor algo match', async () => {
    const getConfig = mockGetConfig({
      'ml.runtimeMatrix': { default: 'backend-in-process' },
    })
    expect(await resolveTrainingRuntime('some-new-game', 'qlearning', { getConfig })).toBe('backend-in-process')
  })

  it('case-folds algorithm names — Q_LEARNING resolves to qlearning', async () => {
    const getConfig = mockGetConfig({
      'ml.runtimeMatrix': {
        'tic-tac-toe': { qlearning: 'frontend' },
      },
    })
    expect(await resolveTrainingRuntime('tic-tac-toe', 'Q_LEARNING', { getConfig })).toBe('frontend')
    expect(await resolveTrainingRuntime('tic-tac-toe', 'QLearning',  { getConfig })).toBe('frontend')
  })

  it('ignores garbage cells (typo) and falls through to next layer', async () => {
    // Admin typo'd 'wroker'; should NOT take down the dispatch — falls
    // through to game-default, then global-default, then code-default.
    const getConfig = mockGetConfig({
      'ml.runtimeMatrix': {
        'tic-tac-toe': { qlearning: 'wroker', default: 'frontend' },
      },
    })
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning', { getConfig })).toBe('frontend')
  })
})

describe('resolveTrainingRuntime — legacy useWorker fallback', () => {
  it('ml.useWorker=true → worker for everything when no matrix set', async () => {
    const getConfig = mockGetConfig({ 'ml.useWorker': true })
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning', { getConfig })).toBe('worker')
    expect(await resolveTrainingRuntime('connect-four', 'alphazero', { getConfig })).toBe('worker')
  })

  it('ml.useWorker=false → backend-in-process for everything when no matrix set', async () => {
    const getConfig = mockGetConfig({ 'ml.useWorker': false })
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning', { getConfig })).toBe('backend-in-process')
  })

  it('matrix wins over legacy useWorker when both present', async () => {
    const getConfig = mockGetConfig({
      'ml.runtimeMatrix': { 'tic-tac-toe': { qlearning: 'frontend' } },
      'ml.useWorker':     true,
    })
    // Matrix says frontend; legacy says worker. Matrix wins.
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning', { getConfig })).toBe('frontend')
  })

  it('matrix without a relevant cell falls through legacy useWorker', async () => {
    const getConfig = mockGetConfig({
      'ml.runtimeMatrix': { 'connect-four': { dqn: 'worker' } }, // no TTT
      'ml.useWorker':     false,
    })
    // No TTT cell, no game default, no global default → legacy fallback applies.
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning', { getConfig })).toBe('backend-in-process')
  })
})

describe('resolveTrainingRuntime — code-default safety net', () => {
  it('returns DEFAULT_MATRIX entry when SystemConfig is empty', async () => {
    const getConfig = mockGetConfig({})
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning',  { getConfig })).toBe('frontend')
    expect(await resolveTrainingRuntime('tic-tac-toe', 'monte_carlo',{ getConfig })).toBe('frontend')
    expect(await resolveTrainingRuntime('tic-tac-toe', 'dqn',        { getConfig })).toBe('worker')
    expect(await resolveTrainingRuntime('connect-four', 'alphazero', { getConfig })).toBe('worker')
  })

  it('unknown game falls to global code default (worker)', async () => {
    const getConfig = mockGetConfig({})
    expect(await resolveTrainingRuntime('unknown-game', 'qlearning', { getConfig })).toBe('worker')
  })

  it('works without any getConfig at all — pure code-default path', async () => {
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning')).toBe('frontend')
    expect(await resolveTrainingRuntime('tic-tac-toe', 'alphazero')).toBe('worker')
  })

  it('treats array as invalid matrix (not an object) and falls through', async () => {
    const getConfig = mockGetConfig({ 'ml.runtimeMatrix': ['not', 'a', 'matrix'] })
    expect(await resolveTrainingRuntime('tic-tac-toe', 'qlearning', { getConfig })).toBe('frontend')
  })

  it('DEFAULT_MATRIX is frozen so accidental mutation is caught', () => {
    expect(Object.isFrozen(DEFAULT_MATRIX)).toBe(true)
  })
})
