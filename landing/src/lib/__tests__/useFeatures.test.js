// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * A3b.8 — useFeatures hook contract.
 *
 * The hook reads /api/v1/config/features once on mount. We assert:
 *   - happy-path: parses the JSON response into `features`.
 *   - HTTP error: returns `{}` and stops loading.
 *   - network error: returns `{}` and stops loading.
 * Caller's default-off behavior (knobs hidden) relies on the empty
 * object fallback in both failure modes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useFeatures } from '../useFeatures.js'

const fetchMock = vi.fn()
globalThis.fetch = fetchMock

beforeEach(() => fetchMock.mockReset())

describe('useFeatures', () => {
  it('parses the features payload on a 200 response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ trainingAdvancedKnobs: true, anotherFlag: false }),
    })
    const { result } = renderHook(() => useFeatures())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.features).toEqual({ trainingAdvancedKnobs: true, anotherFlag: false })
  })

  it('returns an empty object on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const { result } = renderHook(() => useFeatures())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.features).toEqual({})
  })

  it('returns an empty object when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useFeatures())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.features).toEqual({})
  })

  it('hits /api/v1/config/features with credentials included', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    renderHook(() => useFeatures())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/config/features', expect.objectContaining({
      credentials: 'include',
    }))
  })
})
