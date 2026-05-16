// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for useOptimisticSession — Future_Ideas tReady follow-up item 1.
 *
 * The hook is a singleton wrapper around `/api/session` fetches. Multiple
 * mounts must share one HTTP round-trip on cold mount + one shared poll
 * timer; on prod we measured 8 parallel `/api/session` GETs from the
 * pre-dedup version, ~150–250 ms of wall-clock on the warm-anon /play path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ user: null, session: null }),
  })
  vi.stubGlobal('fetch', fetchMock)
  // Fresh singleton state per test — the module keeps state across imports
  // so we explicitly reset.
  return import('../useOptimisticSession.js').then(m => m._resetForTests())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useOptimisticSession — shared-singleton dedup', () => {
  it('cold mount of 5 hook instances triggers exactly ONE /api/session GET', async () => {
    const { useOptimisticSession } = await import('../useOptimisticSession.js')

    // Render 5 separate hook instances simultaneously.
    const hooks = Array.from({ length: 5 }, () => renderHook(() => useOptimisticSession()))

    // Wait for the shared fetch to settle.
    await waitFor(() => {
      for (const h of hooks) expect(h.result.current.isPending).toBe(false)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/session', expect.objectContaining({
      credentials: 'include',
    }))
  })

  it('all subscribers see the same session state after fetch settles', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: 'u1', name: 'Alice' }, session: { id: 's1' } }),
    })
    const { useOptimisticSession } = await import('../useOptimisticSession.js')

    const a = renderHook(() => useOptimisticSession())
    const b = renderHook(() => useOptimisticSession())

    await waitFor(() => expect(a.result.current.isPending).toBe(false))
    expect(a.result.current.data?.user?.id).toBe('u1')
    expect(b.result.current.data?.user?.id).toBe('u1')
  })

  it('returns null session (anon) without exposing the raw response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: null, session: null }),
    })
    const { useOptimisticSession } = await import('../useOptimisticSession.js')

    const { result } = renderHook(() => useOptimisticSession())
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.data).toBe(null)
  })

  it('triggerSessionRefresh fires exactly one fresh fetch and notifies all subscribers', async () => {
    const { useOptimisticSession, triggerSessionRefresh } = await import('../useOptimisticSession.js')

    const a = renderHook(() => useOptimisticSession())
    const b = renderHook(() => useOptimisticSession())
    await waitFor(() => expect(a.result.current.isPending).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ user: { id: 'u_after_signin', name: 'Bob' }, session: {} }),
    })
    await act(async () => { triggerSessionRefresh() })

    await waitFor(() => expect(a.result.current.data?.user?.id).toBe('u_after_signin'))
    expect(b.result.current.data?.user?.id).toBe('u_after_signin')
    // Exactly one extra fetch — the refresh, not one per subscriber.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a fetch that fails returns null and clears pending without throwing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    const { useOptimisticSession } = await import('../useOptimisticSession.js')

    const { result } = renderHook(() => useOptimisticSession())
    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.data).toBe(null)
  })

  it('unmounting all subscribers stops the poll (no leaked fetches)', async () => {
    const { useOptimisticSession } = await import('../useOptimisticSession.js')

    const h = renderHook(() => useOptimisticSession())
    await waitFor(() => expect(h.result.current.isPending).toBe(false))
    const beforeUnmount = fetchMock.mock.calls.length

    h.unmount()
    // Give the singleton's promise chain a tick to settle its `_timerId`
    // assignment, then assert no further fetch fires.
    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock.mock.calls.length).toBe(beforeUnmount)
  })
})
