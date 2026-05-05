// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for `useSWRish` (Phase 20.3).
 * See landing/src/lib/swr.js + doc/Performance_Plan_v2.md §Phase 20.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSWRish } from '../swr.js'

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('useSWRish — cold load', () => {
  it('starts with data=null, isLoading=true, isStale=false', async () => {
    let resolveFetch
    const fetcher = vi.fn(() => new Promise(r => { resolveFetch = r }))
    const { result } = renderHook(() => useSWRish('cold-key', fetcher))

    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(true)
    expect(result.current.isStale).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(async () => { resolveFetch({ items: [1, 2, 3] }) })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toEqual({ items: [1, 2, 3] })
    expect(result.current.isStale).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('writes to localStorage on success so the next mount paints sync', async () => {
    const fetcher = vi.fn().mockResolvedValue({ a: 1 })
    const { result, unmount } = renderHook(() => useSWRish('cache-write', fetcher))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const raw = localStorage.getItem('xo_swr_cache-write')
    expect(raw).toBeTruthy()
    const entry = JSON.parse(raw)
    expect(entry.data).toEqual({ a: 1 })
    expect(typeof entry.ts).toBe('number')

    unmount()
  })
})

describe('useSWRish — warm load', () => {
  it('paints cached data on mount and re-validates in the background', async () => {
    localStorage.setItem('xo_swr_warm', JSON.stringify({ data: { v: 'old' }, ts: Date.now() }))

    let resolveFetch
    const fetcher = vi.fn(() => new Promise(r => { resolveFetch = r }))
    const { result } = renderHook(() => useSWRish('warm', fetcher))

    // Synchronous cache hit — no spinner.
    expect(result.current.data).toEqual({ v: 'old' })
    expect(result.current.isLoading).toBe(false)
    expect(result.current.isStale).toBe(true)

    await act(async () => { resolveFetch({ v: 'new' }) })
    await waitFor(() => expect(result.current.isStale).toBe(false))

    expect(result.current.data).toEqual({ v: 'new' })
  })

  it('treats expired cache as cold', async () => {
    localStorage.setItem('xo_swr_expired', JSON.stringify({
      data: { v: 'stale' },
      ts:   Date.now() - 10 * 60_000,   // 10 min ago
    }))
    const fetcher = vi.fn().mockResolvedValue({ v: 'fresh' })
    const { result } = renderHook(() => useSWRish('expired', fetcher, { maxAgeMs: 5 * 60_000 }))

    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({ v: 'fresh' }))
  })

  it('keeps showing cached data when the revalidate fails', async () => {
    localStorage.setItem('xo_swr_err', JSON.stringify({ data: { v: 'cache' }, ts: Date.now() }))
    const fetcher = vi.fn().mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSWRish('err', fetcher))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.data).toEqual({ v: 'cache' })
    expect(result.current.error.message).toBe('boom')
  })
})

describe('useSWRish — key change', () => {
  it('refetches and swaps to the new key cache when key changes', async () => {
    localStorage.setItem('xo_swr_a', JSON.stringify({ data: { k: 'A' }, ts: Date.now() }))
    localStorage.setItem('xo_swr_b', JSON.stringify({ data: { k: 'B' }, ts: Date.now() }))

    const fetcher = vi.fn(async () => ({ k: 'fresh' }))
    const { result, rerender } = renderHook(
      ({ k }) => useSWRish(k, fetcher),
      { initialProps: { k: 'a' } },
    )

    expect(result.current.data).toEqual({ k: 'A' })

    rerender({ k: 'b' })
    expect(result.current.data).toEqual({ k: 'B' })
    await waitFor(() => expect(result.current.isStale).toBe(false))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does NOT refetch when only the fetcher reference changes', async () => {
    const fetcher1 = vi.fn().mockResolvedValue({ v: 1 })
    const { rerender } = renderHook(
      ({ f }) => useSWRish('stable-key', f),
      { initialProps: { f: fetcher1 } },
    )
    await waitFor(() => expect(fetcher1).toHaveBeenCalledTimes(1))

    const fetcher2 = vi.fn().mockResolvedValue({ v: 2 })
    rerender({ f: fetcher2 })

    // Settle the microtask queue.
    await new Promise(r => setTimeout(r, 0))
    expect(fetcher2).not.toHaveBeenCalled()
  })
})

describe('useSWRish — refresh()', () => {
  it('exposes an imperative refresh that re-runs the fetcher', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ v: 1 })
      .mockResolvedValueOnce({ v: 2 })
    const { result } = renderHook(() => useSWRish('manual', fetcher))
    await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))

    await act(async () => { await result.current.refresh() })
    expect(result.current.data).toEqual({ v: 2 })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('useSWRish — mutate()', () => {
  it('overwrites data with a value and writes through to the cache', async () => {
    const fetcher = vi.fn().mockResolvedValue({ tables: ['a'] })
    const { result } = renderHook(() => useSWRish('mutate-value', fetcher))
    await waitFor(() => expect(result.current.data).toEqual({ tables: ['a'] }))

    act(() => { result.current.mutate({ tables: ['b'] }) })
    expect(result.current.data).toEqual({ tables: ['b'] })

    const raw = JSON.parse(localStorage.getItem('xo_swr_mutate-value'))
    expect(raw.data).toEqual({ tables: ['b'] })
  })

  it('supports a functional updater for optimistic prepend', async () => {
    const fetcher = vi.fn().mockResolvedValue({ tables: ['existing'] })
    const { result } = renderHook(() => useSWRish('mutate-fn', fetcher))
    await waitFor(() => expect(result.current.data).toEqual({ tables: ['existing'] }))

    act(() => {
      result.current.mutate(prev => ({
        ...prev,
        tables: ['new', ...(prev?.tables ?? [])],
      }))
    })
    expect(result.current.data).toEqual({ tables: ['new', 'existing'] })
  })

  it('does NOT call the fetcher (optimistic-only — caller decides whether to refresh)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ x: 0 })
    const { result } = renderHook(() => useSWRish('mutate-no-refetch', fetcher))
    await waitFor(() => expect(result.current.data).toEqual({ x: 0 }))
    fetcher.mockClear()

    act(() => { result.current.mutate({ x: 1 }) })
    expect(result.current.data).toEqual({ x: 1 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('clears isStale + error so optimistic data is treated as fresh', async () => {
    localStorage.setItem('xo_swr_mutate-stale', JSON.stringify({ data: { x: 'cached' }, ts: Date.now() }))
    const fetcher = vi.fn().mockRejectedValue(new Error('fail'))
    const { result } = renderHook(() => useSWRish('mutate-stale', fetcher))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.isStale).toBe(true)

    act(() => { result.current.mutate({ x: 'optimistic' }) })
    expect(result.current.isStale).toBe(false)
    expect(result.current.error).toBeNull()
  })
})

describe('useSWRish — defensive', () => {
  it('does not throw if localStorage is unavailable', async () => {
    const orig = Storage.prototype.getItem
    Storage.prototype.getItem = () => { throw new Error('no localStorage') }
    try {
      const fetcher = vi.fn().mockResolvedValue({ v: 1 })
      const { result } = renderHook(() => useSWRish('no-ls', fetcher))
      // No cache → cold load.
      expect(result.current.data).toBeNull()
      expect(result.current.isLoading).toBe(true)
      await waitFor(() => expect(result.current.data).toEqual({ v: 1 }))
    } finally {
      Storage.prototype.getItem = orig
    }
  })

  it('ignores cache entries with malformed JSON', async () => {
    localStorage.setItem('xo_swr_bad', '{not-json')
    const fetcher = vi.fn().mockResolvedValue({ v: 'ok' })
    const { result } = renderHook(() => useSWRish('bad', fetcher))
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(true)
    await waitFor(() => expect(result.current.data).toEqual({ v: 'ok' }))
  })
})
