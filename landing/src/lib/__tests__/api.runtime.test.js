// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.10 — api.ml.getRuntime contract.
 *
 * Thin assertion that the helper builds the right URL (with proper
 * encoding) and parses the response. The substantive routing logic
 * lives in trainingRuntime.test.js (backend) and TrainTab consumes
 * this helper to branch on the verdict.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the underlying request layer the api object uses. We assert on
// the URL passed to fetch — that's the actual contract between the UI
// and the backend route.
const fetchMock = vi.fn()
globalThis.fetch = fetchMock

beforeEach(() => fetchMock.mockReset())

const { api } = await import('../api.js')

describe('api.ml.getRuntime', () => {
  it('GETs /ml/runtime with gameId + algorithm query params (URL-encoded)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ gameId: 'tic-tac-toe', algorithm: 'qlearning', runtime: 'frontend' }),
    })
    const res = await api.ml.getRuntime('tic-tac-toe', 'qlearning')
    expect(res).toEqual({ gameId: 'tic-tac-toe', algorithm: 'qlearning', runtime: 'frontend' })

    const url = fetchMock.mock.calls[0][0]
    expect(url).toMatch(/\/ml\/runtime\?gameId=tic-tac-toe&algorithm=qlearning$/)
  })

  it('URL-encodes special characters in gameId / algorithm', async () => {
    fetchMock.mockResolvedValue({
      ok: true, status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ runtime: 'worker' }),
    })
    // Pick chars encodeURIComponent actually escapes (excludes the
    // unreserved set: alphanumerics, '-', '_', '.', '~', '!', '*', '(', ')').
    await api.ml.getRuntime('weird game&val', 'algo/with/slash')
    const url = fetchMock.mock.calls[0][0]
    expect(url).toContain('gameId=weird%20game%26val')
    expect(url).toContain('algorithm=algo%2Fwith%2Fslash')
  })

  it('passes through worker / backend-in-process verdicts unchanged', async () => {
    for (const runtime of ['worker', 'backend-in-process']) {
      fetchMock.mockResolvedValueOnce({
        ok: true, status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ gameId: 'connect-four', algorithm: 'alphazero', runtime }),
      })
      const res = await api.ml.getRuntime('connect-four', 'alphazero')
      expect(res.runtime).toBe(runtime)
    }
  })
})
