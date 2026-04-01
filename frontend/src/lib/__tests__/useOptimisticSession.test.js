import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOptimisticSession, clearSessionCache } from '../useOptimisticSession.js'
import { authClient } from '../auth-client.js'

// ---------------------------------------------------------------------------
// Mock authClient
// ---------------------------------------------------------------------------

vi.mock('../auth-client.js', () => ({
  authClient: {
    useSession: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const CACHE_KEY = 'xo_session_cache'

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed localStorage with a valid session cache entry. */
function seedCache(sessionData) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(sessionData))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useOptimisticSession', () => {
  it('returns {data: null, isPending: true} when no cache and session pending', () => {
    authClient.useSession.mockReturnValue({ data: undefined, isPending: true })

    const { result } = renderHook(() => useOptimisticSession())

    expect(result.current.data).toBeNull()
    expect(result.current.isPending).toBe(true)
  })

  it('returns cached data immediately when localStorage has a valid cache', () => {
    const cachedSession = { user: { id: 'u1', name: 'Alice' } }
    seedCache(cachedSession)

    // Real session still pending
    authClient.useSession.mockReturnValue({ data: undefined, isPending: true })

    const { result } = renderHook(() => useOptimisticSession())

    expect(result.current.data).toEqual(cachedSession)
  })

  it('returns isPending: false when cache exists even if authClient is still pending', () => {
    const cachedSession = { user: { id: 'u2', name: 'Bob' } }
    seedCache(cachedSession)

    authClient.useSession.mockReturnValue({ data: undefined, isPending: true })

    const { result } = renderHook(() => useOptimisticSession())

    expect(result.current.isPending).toBe(false)
  })

  it('updates data when authClient.useSession resolves', () => {
    // Start with no cache, session pending
    authClient.useSession.mockReturnValue({ data: undefined, isPending: true })

    const { result, rerender } = renderHook(() => useOptimisticSession())

    expect(result.current.data).toBeNull()
    expect(result.current.isPending).toBe(true)

    // Session resolves
    const resolvedSession = { user: { id: 'u3', name: 'Carol' } }
    authClient.useSession.mockReturnValue({ data: resolvedSession, isPending: false })

    act(() => {
      rerender()
    })

    expect(result.current.data).toEqual(resolvedSession)
    expect(result.current.isPending).toBe(false)
  })

  it('writes resolved session to localStorage cache', () => {
    authClient.useSession.mockReturnValue({ data: undefined, isPending: true })

    const { rerender } = renderHook(() => useOptimisticSession())

    const resolvedSession = { user: { id: 'u4', name: 'Dave' } }
    authClient.useSession.mockReturnValue({ data: resolvedSession, isPending: false })

    act(() => {
      rerender()
    })

    const stored = JSON.parse(localStorage.getItem(CACHE_KEY))
    expect(stored).toEqual(resolvedSession)
  })
})

describe('clearSessionCache', () => {
  it('removes the localStorage session cache entry', () => {
    seedCache({ user: { id: 'u5' } })
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull()

    clearSessionCache()

    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('does not throw when there is no cache entry to remove', () => {
    expect(() => clearSessionCache()).not.toThrow()
  })
})
