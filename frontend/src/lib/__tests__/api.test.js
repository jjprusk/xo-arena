import { describe, it, expect, vi, beforeEach } from 'vitest'
import { request as _request, cachedFetch, prefetch, api } from '../api.js'

// request is not exported directly — test via api.get/post or via the behaviour
// we observe through api.*. For direct request tests we use api.get/api.post which
// delegate straight to the internal request function.

// Mock fetch globally
global.fetch = vi.fn()

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockOkResponse(data, status = 200) {
  global.fetch.mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(data),
  })
}

function mockErrorResponse(status, errorBody) {
  global.fetch.mockResolvedValue({
    ok: false,
    status,
    statusText: 'Unauthorized',
    json: () => Promise.resolve(errorBody ?? { error: 'Unauthorized' }),
  })
}

// ---------------------------------------------------------------------------
// request (tested via api.get / api.post)
// ---------------------------------------------------------------------------

describe('request', () => {
  it('GET — sends request with correct URL and Authorization header', async () => {
    mockOkResponse({ ok: true })
    await api.get('/admin/stats', 'my-token')

    expect(fetch).toHaveBeenCalledOnce()
    const [url, opts] = fetch.mock.calls[0]
    expect(url).toContain('/api/v1/admin/stats')
    expect(opts.method).toBe('GET')
    expect(opts.headers['Authorization']).toBe('Bearer my-token')
  })

  it('POST — sends JSON body', async () => {
    mockOkResponse({ created: true })
    await api.post('/games', { board: [0, 1, 2] }, 'tok')

    const [, opts] = fetch.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(opts.body).toBe(JSON.stringify({ board: [0, 1, 2] }))
    expect(opts.headers['Content-Type']).toBe('application/json')
  })

  it('throws with status code when response is not ok', async () => {
    mockErrorResponse(401, { error: 'Unauthorized' })

    await expect(api.get('/admin/stats', 'bad-token')).rejects.toMatchObject({
      message: 'Unauthorized',
      status: 401,
    })
  })

  it('returns parsed JSON on success', async () => {
    const payload = { users: [{ id: '1' }] }
    mockOkResponse(payload)

    const result = await api.get('/admin/users', 'tok')
    expect(result).toEqual(payload)
  })
})

// ---------------------------------------------------------------------------
// cachedFetch
// ---------------------------------------------------------------------------

describe('cachedFetch', () => {
  it('returns {immediate: null, refresh: Promise} on cache miss', () => {
    mockOkResponse({ data: 'fresh' })

    const { immediate, refresh } = cachedFetch('/some/path')
    expect(immediate).toBeNull()
    expect(refresh).toBeInstanceOf(Promise)
  })

  it('immediate is cached data when localStorage has a fresh entry', () => {
    const cached = { items: [1, 2, 3] }
    localStorage.setItem(
      'xo_swr_/cached/path',
      JSON.stringify({ data: cached, ts: Date.now() }),
    )

    const { immediate } = cachedFetch('/cached/path', 5 * 60_000)
    expect(immediate).toEqual(cached)
  })

  it('refresh promise fetches fresh data and updates localStorage', async () => {
    const fresh = { items: ['a', 'b'] }
    mockOkResponse(fresh)

    const { refresh } = cachedFetch('/fresh/path')
    const result = await refresh

    expect(result).toEqual(fresh)

    const stored = JSON.parse(localStorage.getItem('xo_swr_/fresh/path'))
    expect(stored.data).toEqual(fresh)
    expect(stored.ts).toBeTypeOf('number')
  })
})

// ---------------------------------------------------------------------------
// prefetch
// ---------------------------------------------------------------------------

describe('prefetch', () => {
  it('does nothing (does not call fetch) when cache is still fresh', () => {
    localStorage.setItem(
      'xo_swr_/prefetch/path',
      JSON.stringify({ data: { ok: true }, ts: Date.now() }),
    )

    prefetch('/prefetch/path', 30_000)

    expect(fetch).not.toHaveBeenCalled()
  })

  it('calls fetch when cache is missing', () => {
    mockOkResponse({ data: 'x' })

    prefetch('/missing/path', 30_000)

    expect(fetch).toHaveBeenCalledOnce()
  })

  it('calls fetch when cache is stale', () => {
    localStorage.setItem(
      'xo_swr_/stale/path',
      JSON.stringify({ data: {}, ts: Date.now() - 60_000 }), // 60 s old, maxAge 30 s
    )
    mockOkResponse({ data: 'x' })

    prefetch('/stale/path', 30_000)

    expect(fetch).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// api.admin.users
// ---------------------------------------------------------------------------

describe('api.admin.users', () => {
  it('includes search param in URL when provided', async () => {
    mockOkResponse({ users: [] })
    await api.admin.users('tok', 'alice', 1, 20)

    const [url] = fetch.mock.calls[0]
    expect(url).toContain('search=alice')
    expect(url).toContain('page=1')
    expect(url).toContain('limit=20')
  })

  it('omits search param when not provided', async () => {
    mockOkResponse({ users: [] })
    await api.admin.users('tok')

    const [url] = fetch.mock.calls[0]
    expect(url).not.toContain('search=')
  })
})

// ---------------------------------------------------------------------------
// api.admin.games
// ---------------------------------------------------------------------------

describe('api.admin.games', () => {
  it('includes mode and outcome filters in URL', async () => {
    mockOkResponse({ games: [] })
    await api.admin.games('tok', 1, 10, { mode: 'hvh', outcome: 'x_wins' })

    const [url] = fetch.mock.calls[0]
    expect(url).toContain('mode=hvh')
    expect(url).toContain('outcome=x_wins')
  })

  it('includes all filters when provided', async () => {
    mockOkResponse({ games: [] })
    await api.admin.games('tok', 2, 5, {
      mode: 'ai',
      outcome: 'draw',
      player: 'user-123',
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
    })

    const [url] = fetch.mock.calls[0]
    expect(url).toContain('mode=ai')
    expect(url).toContain('outcome=draw')
    expect(url).toContain('player=user-123')
    expect(url).toContain('dateFrom=2026-01-01')
    expect(url).toContain('dateTo=2026-03-31')
  })

  it('omits filter params when filters object is empty', async () => {
    mockOkResponse({ games: [] })
    await api.admin.games('tok', 1, 10, {})

    const [url] = fetch.mock.calls[0]
    expect(url).not.toContain('mode=')
    expect(url).not.toContain('outcome=')
  })
})
