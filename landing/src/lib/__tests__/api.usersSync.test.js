// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 1c — `users.sync` in-flight dedupe.
 *
 * AppLayout fires two parallel effects on cold-authed first paint that
 * both call `api.users.sync(token)`. Without dedupe each fires its own
 * round-trip — ~60ms p50 wasted RTT, ~30% of cold-authed Ready (perf
 * doc §F11.4). The dedupe wraps the in-flight promise in a per-token
 * Map so concurrent callers share one request. Once it settles, the
 * entry is cleared so retries hit the network fresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../api.js'

describe('api.users.sync — Phase 1c in-flight dedupe', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shares one fetch when called concurrently with the same token', async () => {
    let resolveFetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      new Promise(resolve => { resolveFetch = resolve })
    )

    const a = api.users.sync('token-1')
    const b = api.users.sync('token-1')
    expect(a).toBe(b)                  // same promise instance
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    resolveFetch(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    await Promise.all([a, b])
  })

  it('refetches after the in-flight promise settles', async () => {
    // Each call gets its own Response — Response bodies are single-use.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
    )

    await api.users.sync('token-1')
    await api.users.sync('token-1')    // second call AFTER first settled
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not collide across different tokens', async () => {
    let resolveA, resolveB
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      const auth = init?.headers?.Authorization ?? ''
      return new Promise(resolve => {
        if (auth.includes('token-A')) resolveA = resolve
        else                          resolveB = resolve
      })
    })

    const a = api.users.sync('token-A')
    const b = api.users.sync('token-B')
    expect(a).not.toBe(b)
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    resolveA(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    resolveB(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    await Promise.all([a, b])
  })

  it('clears the cache entry even when the request fails', async () => {
    let rejectFetch
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() =>
      new Promise((_, reject) => { rejectFetch = reject })
    )

    const failing = api.users.sync('token-1').catch(() => 'caught')
    rejectFetch(new Error('network down'))
    await failing

    // After failure, a fresh call must hit the network again — not return
    // the dead promise.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    )
    await api.users.sync('token-1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
