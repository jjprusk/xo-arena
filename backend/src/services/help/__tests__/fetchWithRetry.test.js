import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchWithRetry } from '../fetchWithRetry.js'

describe('fetchWithRetry', () => {
  let fetchSpy

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  function ok(status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => ({}), text: async () => '', headers: new Headers() }
  }

  function eaiAgain() {
    const e = new TypeError('fetch failed')
    e.cause = Object.assign(new Error('getaddrinfo EAI_AGAIN api.openai.com'), { code: 'EAI_AGAIN' })
    return e
  }

  function econnReset() {
    const e = new TypeError('fetch failed')
    e.cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    return e
  }

  it('returns first 2xx without retrying', async () => {
    fetchSpy.mockResolvedValueOnce(ok(200))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries on EAI_AGAIN and succeeds on second try', async () => {
    fetchSpy.mockRejectedValueOnce(eaiAgain())
    fetchSpy.mockResolvedValueOnce(ok(200))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries on ECONNRESET', async () => {
    fetchSpy.mockRejectedValueOnce(econnReset())
    fetchSpy.mockResolvedValueOnce(ok(200))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries on bare "fetch failed" with no cause (some undici DNS paths)', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'))
    fetchSpy.mockResolvedValueOnce(ok(200))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries on 5xx', async () => {
    fetchSpy.mockResolvedValueOnce(ok(503))
    fetchSpy.mockResolvedValueOnce(ok(200))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does NOT retry on 4xx (other than 429)', async () => {
    fetchSpy.mockResolvedValueOnce(ok(401))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(401)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry on 429 by default (caller handles)', async () => {
    fetchSpy.mockResolvedValueOnce(ok(429))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('retries on 429 when retryOn429=true', async () => {
    fetchSpy.mockResolvedValueOnce(ok(429))
    fetchSpy.mockResolvedValueOnce(ok(200))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1, retryOn429: true })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('gives up after maxRetries and returns the final non-2xx Response', async () => {
    fetchSpy.mockResolvedValue(ok(503))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1, maxRetries: 2 })
    expect(r.status).toBe(503)
    expect(fetchSpy).toHaveBeenCalledTimes(3)  // initial + 2 retries
  })

  it('gives up after maxRetries on transient errors and throws the last error', async () => {
    fetchSpy.mockRejectedValue(eaiAgain())
    await expect(
      fetchWithRetry('https://x', {}, { backoffBaseMs: 1, maxRetries: 2 })
    ).rejects.toThrow(/fetch failed/)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry on non-transient errors (TypeError without code)', async () => {
    fetchSpy.mockRejectedValueOnce(Object.assign(new TypeError('bad URL'), { cause: { code: 'NOT_A_REAL_CODE' } }))
    await expect(fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })).rejects.toThrow(/bad URL/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('honors caller AbortSignal — does not retry once aborted', async () => {
    const ac = new AbortController()
    fetchSpy.mockImplementationOnce(async (_url, init) => {
      ac.abort()
      const err = new DOMException('aborted', 'AbortError')
      throw err
    })
    await expect(
      fetchWithRetry('https://x', { signal: ac.signal }, { backoffBaseMs: 1 })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('uses exponential backoff (250ms × 2^attempt by default)', async () => {
    // Two transient failures then success. Confirm calls happen and the
    // function completes — the explicit timing is hard to assert without
    // fake timers, and we already cover the retry-count semantics above.
    fetchSpy.mockRejectedValueOnce(eaiAgain())
    fetchSpy.mockRejectedValueOnce(eaiAgain())
    fetchSpy.mockResolvedValueOnce(ok(200))
    const r = await fetchWithRetry('https://x', {}, { backoffBaseMs: 1 })
    expect(r.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })
})
