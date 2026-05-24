// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Pins the algorithm-string normalization for the worker-side training
// dispatch in `mlService.js`. This file exists because a real bug
// shipped to staging where flat-form algorithm strings (`alphazero`,
// `montecarlo`, `policygradient`) silently fell through to the
// QLearning fallback inside `_buildEngine` / `_runEpisodeForAlgorithm`
// — the legacy enum branches (`ALPHA_ZERO`, `MONTE_CARLO`,
// `POLICY_GRADIENT`) never matched the underscore-stripped uppercase
// form. Fixed by mirroring `skillService`'s `.replace(/_/g, '')` step.
//
// Test contract: both legacy AND flat forms route to the same engine
// class + the same runner. If a future refactor reintroduces the
// asymmetry, these tests fail.

import { describe, it, expect, vi } from 'vitest'

// Avoid pulling Prisma + the BullMQ queue at module-load time. The two
// helpers under test are pure (no DB, no I/O), but mlService.js touches
// `lib/db.js` and `queue/trainingQueue.js` at top-level.
vi.mock('../../lib/db.js',              () => ({ default: {} }))
vi.mock('../../queue/trainingQueue.js', () => ({
  enqueueTrainingStart: vi.fn(),
  getTrainingQueue:     vi.fn(),
  TRAINING_QUEUE_NAME:  'training',
}))

const {
  _buildEngine, _runEpisodeForAlgorithm,
} = await import('../mlService.js')

const {
  QLearningEngine, SarsaEngine, MonteCarloEngine,
  PolicyGradientEngine, DQNEngine, AlphaZeroEngine,
} = await import('@xo-arena/ai')

const ALGORITHM_ENGINE_PAIRS = [
  // qlearning is the default fallback so both forms work, but we still
  // assert the class to lock the contract.
  { legacy: 'Q_LEARNING',      flat: 'qlearning',      Class: QLearningEngine },
  { legacy: 'SARSA',           flat: 'sarsa',          Class: SarsaEngine },
  { legacy: 'MONTE_CARLO',     flat: 'montecarlo',     Class: MonteCarloEngine },
  { legacy: 'POLICY_GRADIENT', flat: 'policygradient', Class: PolicyGradientEngine },
  { legacy: 'DQN',             flat: 'dqn',            Class: DQNEngine },
  { legacy: 'ALPHA_ZERO',      flat: 'alphazero',      Class: AlphaZeroEngine },
]

describe('_buildEngine', () => {
  it.each(ALGORITHM_ENGINE_PAIRS)(
    'legacy "$legacy" → $Class.name',
    ({ legacy, Class }) => {
      const engine = _buildEngine({}, legacy)
      expect(engine).toBeInstanceOf(Class)
    },
  )

  it.each(ALGORITHM_ENGINE_PAIRS)(
    'flat "$flat" → $Class.name (regression: did NOT silently fall back to QLearning)',
    ({ flat, Class }) => {
      const engine = _buildEngine({}, flat)
      expect(engine).toBeInstanceOf(Class)
    },
  )

  it('alias forms still resolve (MC / PG / AZ)', () => {
    expect(_buildEngine({}, 'MC')).toBeInstanceOf(MonteCarloEngine)
    expect(_buildEngine({}, 'PG')).toBeInstanceOf(PolicyGradientEngine)
    expect(_buildEngine({}, 'AZ')).toBeInstanceOf(AlphaZeroEngine)
  })

  it('case + dash insensitivity (admin-typed strings)', () => {
    expect(_buildEngine({}, 'AlphaZero')).toBeInstanceOf(AlphaZeroEngine)
    expect(_buildEngine({}, 'monteCarlo')).toBeInstanceOf(MonteCarloEngine)
  })

  it('null / undefined / empty → QLearning default', () => {
    expect(_buildEngine({}, null)).toBeInstanceOf(QLearningEngine)
    expect(_buildEngine({}, undefined)).toBeInstanceOf(QLearningEngine)
    expect(_buildEngine({}, '')).toBeInstanceOf(QLearningEngine)
  })
})

// ── Runner dispatch ──────────────────────────────────────────────────
//
// The five runner functions live in module scope so we can't spy on
// them directly. Instead we exploit a unique-method signature per
// runner: each runner calls engine methods that the others don't.
//   - QLearning / Sarsa / MonteCarlo / PG runners → `chooseAction`
//     (with explore=true)
//   - DQN runner                                  → `pushExperience`
//                                                 + `trainStep`
//   - AlphaZero runner                            → `runEpisode`
// A fake engine that throws a tagged sentinel from the expected method
// lets us assert "the right runner ran" without needing the full
// engine implementation.

function fakeEngineThatThrowsFrom(method) {
  const tag = `RUNNER_HIT:${method}`
  return new Proxy({}, {
    get: (_t, prop) => () => { throw new Error(prop === method ? tag : `unexpected:${String(prop)}`) },
  })
}

const RUNNER_SIGNATURE = [
  // alphazero: runEpisode is the one and only engine call
  { algorithm: 'alphazero',      flat: 'alphazero',      expectedMethod: 'runEpisode' },
  { algorithm: 'ALPHA_ZERO',     flat: 'ALPHA_ZERO',     expectedMethod: 'runEpisode' },
  { algorithm: 'AZ',             flat: 'AZ',             expectedMethod: 'runEpisode' },
  // dqn: first engine call is chooseAction (then pushExperience + trainStep)
  { algorithm: 'dqn',            flat: 'dqn',            expectedMethod: 'chooseAction' },
  { algorithm: 'DQN',            flat: 'DQN',            expectedMethod: 'chooseAction' },
  // The tabular runners (q-learning / sarsa / mc / pg) all open with
  // chooseAction. We don't differentiate them here — _buildEngine
  // tests above already pin the engine class.
  { algorithm: 'qlearning',      flat: 'qlearning',      expectedMethod: 'chooseAction' },
  { algorithm: 'sarsa',          flat: 'sarsa',          expectedMethod: 'chooseAction' },
  { algorithm: 'montecarlo',     flat: 'montecarlo',     expectedMethod: 'chooseAction' },
  { algorithm: 'policygradient', flat: 'policygradient', expectedMethod: 'chooseAction' },
]

describe('_runEpisodeForAlgorithm — dispatch signature', () => {
  it.each(RUNNER_SIGNATURE)(
    '$algorithm → calls engine.$expectedMethod first (legacy + flat path agree)',
    ({ algorithm, expectedMethod }) => {
      const engine = fakeEngineThatThrowsFrom(expectedMethod)
      let err
      try { _runEpisodeForAlgorithm(engine, 'X', () => 0, algorithm) } catch (e) { err = e }
      expect(err).toBeDefined()
      expect(err.message).toBe(`RUNNER_HIT:${expectedMethod}`)
    },
  )
})
