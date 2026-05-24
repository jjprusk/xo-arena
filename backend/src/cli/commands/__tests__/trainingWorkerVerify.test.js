// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Unit coverage for the importable `verifyWorkerRouting` function.
// The real I/O side is a single fetch call; mocking it lets the polling
// state machine + result-aggregation be tested deterministically without
// a backend.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { verifyWorkerRouting, TTT_TRAINABLE_ALGORITHMS, assertSummarySignature } from '../trainingWorkerVerify.js'

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock
})

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  }
}

/**
 * Helper that responds to:
 *   POST /qa/training-worker/start → { sessionId: 'sess_<algo>' }
 *   GET  /qa/training-recovery/status → returns sessions per the
 *                                       caller-supplied scenario map.
 *
 * `statusByCall` is consumed in order — each polling round-trip pulls
 * the next snapshot, so tests can model "RUNNING → COMPLETED" by
 * supplying two snapshots in sequence.
 */
function mockBackend({ startOk = true, statusByCall = [] }) {
  let callIdx = 0
  fetchMock.mockImplementation(async (url, init = {}) => {
    if (init.method === 'POST') {
      if (!startOk) return jsonResponse({ error: 'boom' }, { ok: false, status: 500 })
      const body = JSON.parse(init.body)
      return jsonResponse({ sessionId: `sess_${body.algorithm}`, skillId: `skill_${body.algorithm}` })
    }
    // GET status — return the next scripted snapshot.
    const snapshot = statusByCall[Math.min(callIdx, statusByCall.length - 1)]
    callIdx++
    return jsonResponse({ sessions: snapshot })
  })
}

describe('verifyWorkerRouting — argument validation', () => {
  it('throws when qaSecret is missing', async () => {
    await expect(verifyWorkerRouting({ baseUrl: 'http://x' })).rejects.toThrow(/qaSecret/)
  })
  it('throws when baseUrl is missing', async () => {
    await expect(verifyWorkerRouting({ qaSecret: 'x' })).rejects.toThrow(/baseUrl/)
  })
})

// A summary shaped like the right engine actually ran. Per-algo overrides
// because the engine-agnostic summary writer puts different "expected"
// values per engine (tabular: high stateCount + low ε; DQN: stateCount=0
// + ε near 1.0; AZ: stateCount=0 + ε=0).
function summaryFor(algo) {
  if (algo === 'dqn')       return { wins: 100, stateCount: 0,   finalEpsilon: 0.92, avgQDelta: 0 }
  if (algo === 'alphazero') return { wins: 100, stateCount: 0,   finalEpsilon: 0,    avgQDelta: 0 }
  return                          { wins: 100, stateCount: 500, finalEpsilon: 0.05, avgQDelta: 0.08 }
}

describe('verifyWorkerRouting — happy path', () => {
  it('all algorithms COMPLETED with correct per-engine signature → pass=5, fail=0', async () => {
    mockBackend({
      statusByCall: [
        TTT_TRAINABLE_ALGORITHMS.map(a => ({
          sessionId: `sess_${a}`, status: 'COMPLETED',
          checkpointEpisode: 1500, iterations: 1500,
          summary: summaryFor(a), modelId: `skill_${a}`,
        })),
      ],
    })
    const { pass, fail, results } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      perAlgoTimeoutMs: 30_000, pollIntervalMs: 0,
    })
    expect(pass).toBe(5)
    expect(fail).toBe(0)
    expect(results.every(r => r.ok)).toBe(true)
    expect(results.map(r => r.algorithm)).toEqual(TTT_TRAINABLE_ALGORITHMS)
  })

  it('uses the supplied algorithms list (subset)', async () => {
    mockBackend({
      statusByCall: [
        [
          { sessionId: 'sess_qlearning', status: 'COMPLETED', checkpointEpisode: 1500, iterations: 1500, summary: summaryFor('qlearning'), modelId: 'm1' },
          { sessionId: 'sess_dqn',       status: 'COMPLETED', checkpointEpisode: 1200, iterations: 1200, summary: summaryFor('dqn'),       modelId: 'm2' },
        ],
      ],
    })
    const { results } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      algorithms: ['qlearning', 'dqn'],
      perAlgoTimeoutMs: 30_000, pollIntervalMs: 0,
    })
    expect(results).toHaveLength(2)
    expect(results.map(r => r.algorithm)).toEqual(['qlearning', 'dqn'])
  })
})

describe('verifyWorkerRouting — failure modes', () => {
  it('start endpoint 500 → algorithm logged as START_FAILED, ok=false', async () => {
    mockBackend({ startOk: false })
    const { pass, fail, results } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      algorithms: ['qlearning'],
      perAlgoTimeoutMs: 5_000, pollIntervalMs: 0,
    })
    expect(pass).toBe(0)
    expect(fail).toBe(1)
    expect(results[0]).toMatchObject({
      algorithm: 'qlearning',
      sessionId: null,
      ok:        false,
      status:    'START_FAILED',
    })
    expect(results[0].error).toMatch(/500/)
  })

  it('session enters FAILED status → ok=false with error from summary', async () => {
    mockBackend({
      statusByCall: [
        [{
          sessionId: 'sess_dqn', status: 'FAILED',
          checkpointEpisode: 50, iterations: 1200,
          summary: { error: 'OOM' }, modelId: 'm1',
        }],
      ],
    })
    const { pass, fail, results } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      algorithms: ['dqn'],
      perAlgoTimeoutMs: 5_000, pollIntervalMs: 0,
    })
    expect(pass).toBe(0)
    expect(fail).toBe(1)
    expect(results[0].ok).toBe(false)
    expect(results[0].status).toBe('FAILED')
    expect(results[0].error).toBe('OOM')
  })

  it('per-algo timeout fires when session never reaches terminal state', async () => {
    mockBackend({
      statusByCall: [
        [{ sessionId: 'sess_alphazero', status: 'RUNNING', checkpointEpisode: 0, iterations: 1100, summary: {}, modelId: 'm1' }],
      ],
    })
    const { pass, fail, results } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      algorithms: ['alphazero'],
      // 0-ms deadline forces an immediate timeout on the first poll.
      perAlgoTimeoutMs: 0, pollIntervalMs: 0,
    })
    expect(pass).toBe(0)
    expect(fail).toBe(1)
    expect(results[0].status).toBe('TIMEOUT')
    expect(results[0].ok).toBe(false)
  })

  it('mixed pass + fail: counts split correctly', async () => {
    mockBackend({
      statusByCall: [
        [
          { sessionId: 'sess_qlearning',  status: 'COMPLETED', checkpointEpisode: 1500, iterations: 1500, summary: summaryFor('qlearning'), modelId: 'm1' },
          { sessionId: 'sess_dqn',        status: 'FAILED',    checkpointEpisode: 50,   iterations: 1200, summary: { error: 'x' },          modelId: 'm2' },
          { sessionId: 'sess_alphazero',  status: 'COMPLETED', checkpointEpisode: 1100, iterations: 1100, summary: summaryFor('alphazero'), modelId: 'm3' },
        ],
      ],
    })
    const { pass, fail } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      algorithms: ['qlearning', 'dqn', 'alphazero'],
      perAlgoTimeoutMs: 5_000, pollIntervalMs: 0,
    })
    expect(pass).toBe(2)
    expect(fail).toBe(1)
  })
})

describe('assertSummarySignature — per-engine "did the right engine run?" check', () => {
  // The exact bug surfaced during the staging dry-run: the worker ran a
  // tabular engine for an AZ-named session because mlService didn't
  // strip the underscore from "ALPHA_ZERO" → "ALPHAZERO". The summary
  // came back with stateCount > 0 and finalEpsilon: 0.05 — values the
  // real AlphaZeroEngine can never produce.
  it('AZ summary with tabular shape → fail (the headline staging bug)', () => {
    const r = assertSummarySignature('alphazero', { stateCount: 1116, finalEpsilon: 0.05, avgQDelta: 0.083 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/stateCount=1116/)
  })

  it('AZ summary with AZ shape (stateCount=0, finalEpsilon=0) → pass', () => {
    expect(assertSummarySignature('alphazero', { stateCount: 0, finalEpsilon: 0 }).ok).toBe(true)
    expect(assertSummarySignature('AZ',        { stateCount: 0, finalEpsilon: 0 }).ok).toBe(true)
    expect(assertSummarySignature('ALPHA_ZERO',{ stateCount: 0, finalEpsilon: 0 }).ok).toBe(true)
  })

  it('DQN summary with tabular shape → fail', () => {
    const r = assertSummarySignature('dqn', { stateCount: 1300, finalEpsilon: 0.05 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/stateCount=1300/)
  })

  it('DQN summary with low epsilon → fail (tabular engine almost certainly ran)', () => {
    const r = assertSummarySignature('dqn', { stateCount: 0, finalEpsilon: 0.05 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/finalEpsilon=0\.05/)
  })

  it('DQN summary with default-slow decay (≈0.9) → pass', () => {
    expect(assertSummarySignature('dqn', { stateCount: 0, finalEpsilon: 0.887 }).ok).toBe(true)
  })

  it('tabular summary (qlearning) with non-zero state coverage + decayed ε → pass', () => {
    expect(assertSummarySignature('qlearning',  { stateCount: 500, finalEpsilon: 0.05 }).ok).toBe(true)
    expect(assertSummarySignature('sarsa',      { stateCount: 500, finalEpsilon: 0.05 }).ok).toBe(true)
    expect(assertSummarySignature('montecarlo', { stateCount: 500, finalEpsilon: 0.05 }).ok).toBe(true)
  })

  it('tabular summary with stateCount=0 → fail (engine never built a Q-table)', () => {
    expect(assertSummarySignature('qlearning', { stateCount: 0, finalEpsilon: 0.05 }).ok).toBe(false)
  })

  it('missing summary → fail with "no summary"', () => {
    expect(assertSummarySignature('qlearning', null).reason).toBe('no summary')
  })
})

describe('verifyWorkerRouting — signature enforcement', () => {
  it('COMPLETED + wrong-engine summary (AZ tabular shape) → ok=false, status=WRONG_ENGINE', async () => {
    mockBackend({
      statusByCall: [
        [{
          sessionId: 'sess_alphazero', status: 'COMPLETED',
          checkpointEpisode: 1100, iterations: 1100,
          // The pre-fix staging signature — proves the fall-through.
          summary: { wins: 670, stateCount: 1116, finalEpsilon: 0.05, avgQDelta: 0.083 },
          modelId: 'm1',
        }],
      ],
    })
    const { pass, fail, results } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      algorithms: ['alphazero'],
      perAlgoTimeoutMs: 5_000, pollIntervalMs: 0,
    })
    expect(pass).toBe(0)
    expect(fail).toBe(1)
    expect(results[0].status).toBe('WRONG_ENGINE')
    expect(results[0].error).toMatch(/stateCount=1116/)
  })
})

describe('verifyWorkerRouting — polling progression', () => {
  it('RUNNING then COMPLETED → final status reflects last poll', async () => {
    mockBackend({
      statusByCall: [
        [{ sessionId: 'sess_qlearning', status: 'RUNNING',   checkpointEpisode: 500,  iterations: 1500, summary: {}, modelId: 'm1' }],
        [{ sessionId: 'sess_qlearning', status: 'COMPLETED', checkpointEpisode: 1500, iterations: 1500, summary: { ...summaryFor('qlearning'), wins: 99 }, modelId: 'm1' }],
      ],
    })
    const { results } = await verifyWorkerRouting({
      baseUrl: 'http://x', qaSecret: 'qa',
      algorithms: ['qlearning'],
      perAlgoTimeoutMs: 30_000, pollIntervalMs: 0,
    })
    expect(results[0].status).toBe('COMPLETED')
    expect(results[0].ok).toBe(true)
    expect(results[0].summary).toEqual(expect.objectContaining({ wins: 99 }))
  })
})
