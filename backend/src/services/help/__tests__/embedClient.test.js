import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { embedText, embedTexts, toPgVectorLiteral, health, RateLimitError, EMBED_DIM } from '../embedClient.js'

// ── Stub-mode tests ────────────────────────────────────────────────────────
// These run under NODE_ENV=test (vitest default) so embedTexts routes to the
// deterministic hash-projection stub. No fetch is made.
describe('embedClient — stub mode (NODE_ENV=test)', () => {
  it('returns a 384-dim vector', async () => {
    const v = await embedText('how do I train a bot')
    expect(v).toHaveLength(EMBED_DIM)
  })

  it('is deterministic — same input → same vector', async () => {
    const a = await embedText('tournaments overview')
    const b = await embedText('tournaments overview')
    expect(a).toEqual(b)
  })

  it('L2-normalizes (magnitude ≈ 1) for non-empty input', async () => {
    const v = await embedText('quick bots training')
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(mag).toBeCloseTo(1, 5)
  })

  it('emits a sentinel vector for empty input (length preserved)', async () => {
    const v = await embedText('')
    expect(v).toHaveLength(EMBED_DIM)
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(mag).toBeGreaterThan(0)
  })

  it('shared tokens → higher cosine similarity than disjoint ones', async () => {
    const a = await embedText('tournament bracket seeding')
    const b = await embedText('tournament cup playoff')
    const c = await embedText('zzzz qqqq xxxx wwww')
    const cos = (x, y) => x.reduce((s, _, i) => s + x[i] * y[i], 0)
    expect(cos(a, b)).toBeGreaterThan(cos(a, c))
  })

  it('embedTexts preserves input order', async () => {
    const out = await embedTexts(['alpha', 'beta'])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(await embedText('alpha'))
    expect(out[1]).toEqual(await embedText('beta'))
  })

  it('embedTexts returns [] for empty array (no fetch, no stub call)', async () => {
    expect(await embedTexts([])).toEqual([])
  })

  it('toPgVectorLiteral formats correctly', () => {
    const v = new Array(EMBED_DIM).fill(0)
    v[0] = 0.5
    v[1] = -0.25
    const lit = toPgVectorLiteral(v)
    expect(lit.startsWith('[0.5,-0.25,0,')).toBe(true)
    expect(lit.endsWith(']')).toBe(true)
  })

  it('toPgVectorLiteral rejects wrong-length input', () => {
    expect(() => toPgVectorLiteral([1, 2, 3])).toThrow(/384/)
  })

  it('health() returns ok in stub mode without network', async () => {
    const h = await health()
    expect(h.ok).toBe(true)
    expect(h.provider).toBe('stub')
  })
})

// ── OpenAI-path tests ──────────────────────────────────────────────────────
// We flip NODE_ENV away from 'test' for the duration of these tests so the
// embedTexts() router selects the OpenAI path. fetch is mocked.
describe('embedClient — OpenAI path', () => {
  let fetchSpy
  let originalEnv
  let originalVitest
  let originalKey

  beforeEach(() => {
    originalEnv    = process.env.NODE_ENV
    originalVitest = process.env.VITEST
    originalKey    = process.env.OPENAI_API_KEY
    // Escape the stub-mode escape hatches so embedTexts() routes to OpenAI.
    process.env.NODE_ENV = 'development'
    delete process.env.VITEST
    process.env.OPENAI_API_KEY = 'sk-test-fake-key'
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    if (originalVitest === undefined) delete process.env.VITEST
    else process.env.VITEST = originalVitest
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalKey
    fetchSpy.mockRestore()
  })

  function mockEmbedResponse(batchSize, opts = {}) {
    const data = Array.from({ length: batchSize }, (_, i) => ({
      object: 'embedding',
      index: i,
      embedding: new Array(EMBED_DIM).fill(0).map((_, k) => (i * 0.001 + k * 0.0001)),
    }))
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ object: 'list', data, model: 'text-embedding-3-small' }),
      text: async () => '',
      headers: new Headers(),
      ...opts,
    })
  }

  it('happy path: one batch fits in one fetch', async () => {
    mockEmbedResponse(3)
    const out = await embedTexts(['a', 'b', 'c'])
    expect(out).toHaveLength(3)
    expect(out[0]).toHaveLength(EMBED_DIM)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const call = fetchSpy.mock.calls[0]
    expect(call[0]).toBe('https://api.openai.com/v1/embeddings')
    const body = JSON.parse(call[1].body)
    expect(body.model).toBe('text-embedding-3-small')
    expect(body.dimensions).toBe(384)
    expect(body.input).toEqual(['a', 'b', 'c'])
    expect(call[1].headers.Authorization).toBe('Bearer sk-test-fake-key')
  })

  it('batches inputs over 100 across multiple fetches', async () => {
    mockEmbedResponse(100)
    mockEmbedResponse(50)
    const inputs = Array.from({ length: 150 }, (_, i) => `text-${i}`)
    const out = await embedTexts(inputs)
    expect(out).toHaveLength(150)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).input).toHaveLength(100)
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body).input).toHaveLength(50)
  })

  it('preserves input order even when API returns out-of-order data', async () => {
    const shuffled = [
      { object: 'embedding', index: 2, embedding: new Array(EMBED_DIM).fill(0.3) },
      { object: 'embedding', index: 0, embedding: new Array(EMBED_DIM).fill(0.1) },
      { object: 'embedding', index: 1, embedding: new Array(EMBED_DIM).fill(0.2) },
    ]
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ object: 'list', data: shuffled, model: 'text-embedding-3-small' }),
      text: async () => '',
      headers: new Headers(),
    })
    const out = await embedTexts(['first', 'second', 'third'])
    expect(out[0][0]).toBe(0.1)
    expect(out[1][0]).toBe(0.2)
    expect(out[2][0]).toBe(0.3)
  })

  it('throws clear error when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(embedTexts(['hello'])).rejects.toThrow(/OPENAI_API_KEY missing/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws on 5xx with status code in the message', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => '{"error":{"message":"service unavailable"}}',
      headers: new Headers(),
    })
    await expect(embedTexts(['hello'])).rejects.toThrow(/openai embed 503/)
  })

  it('throws RateLimitError with retryAfter on 429', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => '{"error":{"message":"rate limited"}}',
      headers: new Headers({ 'retry-after': '12' }),
    })
    await expect(embedTexts(['hello'])).rejects.toMatchObject({
      name: 'RateLimitError',
      retryAfter: 12,
    })
  })

  it('RateLimitError with no retry-after header has retryAfter=null', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => '',
      headers: new Headers(),
    })
    try {
      await embedTexts(['hello'])
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError)
      expect(err.retryAfter).toBeNull()
    }
  })

  it('throws if response data length does not match input length', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ object: 'list', data: [{ index: 0, embedding: new Array(EMBED_DIM).fill(0) }], model: 'text-embedding-3-small' }),
      text: async () => '',
      headers: new Headers(),
    })
    await expect(embedTexts(['a', 'b'])).rejects.toThrow(/malformed response/)
  })

  it('throws if a returned embedding has wrong dimension', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        object: 'list',
        data: [{ index: 0, embedding: [1, 2, 3] }],
        model: 'text-embedding-3-small',
      }),
      text: async () => '',
      headers: new Headers(),
    })
    await expect(embedTexts(['a'])).rejects.toThrow(/bad embedding shape/)
  })

  it('HELP_EMBED_STUB=1 forces stub even when NODE_ENV != test', async () => {
    process.env.HELP_EMBED_STUB = '1'
    try {
      const out = await embedTexts(['hello'])
      expect(out).toHaveLength(1)
      expect(out[0]).toHaveLength(EMBED_DIM)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      delete process.env.HELP_EMBED_STUB
    }
  })

  it('health() returns ok=true with measured latency on success', async () => {
    mockEmbedResponse(1)
    const h = await health()
    expect(h.ok).toBe(true)
    expect(h.provider).toBe('openai')
    expect(h.model).toBe('text-embedding-3-small')
    expect(h.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('health() returns ok=false with error on failure (never throws)', async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'server error',
      headers: new Headers(),
    })
    const h = await health()
    expect(h.ok).toBe(false)
    expect(h.error).toMatch(/openai embed 500/)
  })
})
