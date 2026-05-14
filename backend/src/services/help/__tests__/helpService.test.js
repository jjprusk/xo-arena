/**
 * Unit tests for helpService — the SQL paths are exercised by 1.11
 * acceptance against a real DB. Here we cover `mergeRanked` (pure) and
 * basic shape of `search` via mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergeRanked, expandQuery } from '../helpService.js'

describe('mergeRanked', () => {
  it('returns empty array when both sources are empty', () => {
    expect(mergeRanked([], [], 0.4)).toEqual([])
  })

  it('with α=1, ranks by FTS only (vector ignored)', () => {
    const fts = [
      { id: 'a', docId: 'd', position: 0, content: 'a', ftsScore: 1.0, cosScore: null },
      { id: 'b', docId: 'd', position: 1, content: 'b', ftsScore: 0.5, cosScore: null },
    ]
    const vec = [
      { id: 'c', docId: 'd', position: 2, content: 'c', ftsScore: null, cosScore: 1.0 },
    ]
    const merged = mergeRanked(fts, vec, 1)
    expect(merged.map(r => r.id)).toEqual(['a', 'b', 'c'])
    expect(merged[0].score).toBeGreaterThan(merged[1].score)
    // 'c' has only vector score; with α=1 its score should be 0.
    expect(merged.find(r => r.id === 'c').score).toBe(0)
  })

  it('with α=0, ranks by vector only (FTS ignored)', () => {
    // 'a' uses position=3 to keep it out of the first-chunk-boost zone —
    // the goal of this test is to verify that α=0 zeros the FTS half,
    // not to exercise the boost (boost is covered by its own test).
    const fts = [
      { id: 'a', docId: 'd', position: 3, content: 'a', ftsScore: 1.0, cosScore: null },
    ]
    const vec = [
      { id: 'b', docId: 'd', position: 1, content: 'b', ftsScore: null, cosScore: 0.9 },
      { id: 'c', docId: 'd', position: 2, content: 'c', ftsScore: null, cosScore: 0.5 },
    ]
    const merged = mergeRanked(fts, vec, 0)
    // 'b' should rank first by vector score; 'a' has only FTS so score=0.
    expect(merged[0].id).toBe('b')
    expect(merged.find(r => r.id === 'a').score).toBe(0)
  })

  it('combines scores for chunks present in both sources', () => {
    const fts = [
      { id: 'a', docId: 'd', position: 0, content: 'a', ftsScore: 1.0, cosScore: null },
      { id: 'b', docId: 'd', position: 1, content: 'b', ftsScore: 0.5, cosScore: null },
    ]
    const vec = [
      { id: 'a', docId: 'd', position: 0, content: 'a', ftsScore: null, cosScore: 1.0 },
      { id: 'b', docId: 'd', position: 1, content: 'b', ftsScore: null, cosScore: 0.6 },
    ]
    const merged = mergeRanked(fts, vec, 0.5)
    // Both chunks should be present once (deduped by id).
    expect(merged).toHaveLength(2)
    // 'a' is top in both → highest combined score
    expect(merged[0].id).toBe('a')
    // 'a' merged row should have both scores set
    const a = merged.find(r => r.id === 'a')
    expect(a.ftsScore).toBe(1.0)
    expect(a.cosScore).toBe(1.0)
  })

  it('normalizes per-source — different scales should not penalize one source', () => {
    // FTS scores are tiny floats (ts_rank_cd ~0.0001); cosine in [0, 1].
    // Both rows have position!=0 so the first-chunk boost doesn't fire.
    const fts = [
      { id: 'a', docId: 'd', position: 5, content: 'a', ftsScore: 0.0001, cosScore: null },
    ]
    const vec = [
      { id: 'b', docId: 'd', position: 6, content: 'b', ftsScore: null, cosScore: 0.9 },
    ]
    const merged = mergeRanked(fts, vec, 0.5)
    const a = merged.find(r => r.id === 'a')
    const b = merged.find(r => r.id === 'b')
    // After normalization (no boost on either), both should have score ≈ 0.5
    expect(a.score).toBeCloseTo(0.5, 5)
    expect(b.score).toBeCloseTo(0.5, 5)
  })

  it('boosts first chunk of doc (position=0) so definitional content surfaces', () => {
    // Two chunks tied on raw signal; the position=0 chunk should out-rank
    // the position=5 chunk thanks to FIRST_CHUNK_BOOST.
    const fts = []
    const vec = [
      { id: 'definition',     docId: 'd', position: 0, content: 'A bot is...', ftsScore: null, cosScore: 0.5 },
      { id: 'detail-chunk',   docId: 'd', position: 5, content: 'Bot tournaments...', ftsScore: null, cosScore: 0.5 },
    ]
    const merged = mergeRanked(fts, vec, 0)  // pure-vector to isolate the boost
    expect(merged[0].id).toBe('definition')
    expect(merged[0].score).toBeGreaterThan(merged[1].score)
    // The gap is exactly the boost (0.08) since base scores are equal.
    expect(merged[0].score - merged[1].score).toBeCloseTo(0.08, 5)
  })

  it('expandQuery passes through queries without alias hits', () => {
    expect(expandQuery('how do I train a bot')).toBe('how do I train a bot')
    expect(expandQuery('what is a tournament')).toBe('what is a tournament')
    expect(expandQuery('')).toBe('')
  })

  it('expandQuery appends canonical phrasing for "tictactoe"', () => {
    expect(expandQuery('how do i play tictactoe')).toBe('how do i play tictactoe tic tac toe')
    // Case-insensitive: matches TicTacToe / TICTACTOE too.
    expect(expandQuery('TicTacToe rules')).toBe('TicTacToe rules tic tac toe')
  })

  it('expandQuery appends canonical phrasing for hyphenated "tic-tac-toe"', () => {
    expect(expandQuery('tic-tac-toe strategy')).toBe('tic-tac-toe strategy tic tac toe')
  })

  it('expandQuery does not duplicate the canonical when multiple variants are present', () => {
    // Both "tictactoe" and "tic-tac-toe" map to the same canonical;
    // dedup via the Set inside expandQuery.
    expect(expandQuery('tictactoe vs tic-tac-toe')).toBe('tictactoe vs tic-tac-toe tic tac toe')
  })

  it('expandQuery is safe to call repeatedly (no regex .lastIndex pollution)', () => {
    expandQuery('tictactoe')
    expandQuery('plain query')
    // The /g regex's lastIndex must reset between calls.
    expect(expandQuery('tictactoe')).toBe('tictactoe tic tac toe')
  })

  it('first-chunk boost does not flip a clearly stronger non-first chunk', () => {
    // Without the boost being too aggressive, a chunk with much higher
    // base score must still win even when the competitor is position=0.
    const fts = []
    const vec = [
      { id: 'weak-first', docId: 'd', position: 0, content: 'intro',  ftsScore: null, cosScore: 0.2 },
      { id: 'strong-mid', docId: 'd', position: 4, content: 'detail', ftsScore: null, cosScore: 0.95 },
    ]
    const merged = mergeRanked(fts, vec, 0)
    expect(merged[0].id).toBe('strong-mid')
  })
})

describe('search (mocked DB)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns empty result for blank query', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn() },
        $queryRaw: vi.fn(),
      },
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { search } = await import('../helpService.js')
    const r = await search('   ')
    expect(r.chunks).toEqual([])
    expect(r.counts).toEqual({ fts: 0, vec: 0, merged: 0 })
  })

  // Shared mock factory for the search-path tests below. The vector
  // branch in helpService.runVectorQuery wraps its SQL in $transaction so
  // it can issue a SET LOCAL ivfflat.probes before the SELECT — so the db
  // mock has to expose $transaction in addition to $queryRaw. The mock
  // forwards the inner $queryRaw call to the outer one to keep test
  // setup terse.
  function makeDbMock({ systemConfigValue = null, queryRawResult = [] } = {}) {
    const queryRaw = vi.fn(async () => queryRawResult)
    return {
      systemConfig: { findUnique: vi.fn(async () => systemConfigValue) },
      $queryRaw: queryRaw,
      $transaction: vi.fn(async (cb) => cb({
        $queryRaw: queryRaw,
        $executeRawUnsafe: vi.fn(async () => 0),
      })),
    }
  }

  it('falls back to default α when SystemConfig is missing', async () => {
    vi.doMock('../../../lib/db.js', () => ({ default: makeDbMock() }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { search } = await import('../helpService.js')
    const r = await search('anything')
    expect(r.alpha).toBe(0.4)
  })

  it('clamps α from SystemConfig to [0, 1]', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: makeDbMock({ systemConfigValue: { value: 2.5 } }),
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { search } = await import('../helpService.js')
    const r = await search('q')
    expect(r.alpha).toBe(1)
  })

  it('reports degraded=false when both branches succeed', async () => {
    vi.doMock('../../../lib/db.js', () => ({ default: makeDbMock() }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { search } = await import('../helpService.js')
    const r = await search('hello world')
    expect(r.degraded).toBe(false)
    expect(r.degradedReason).toBeNull()
  })
})

describe('search — degraded fallback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function setupDegradedScenario({ embedError, ftsRows = [] }) {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async (parts) => {
          // The fts branch issues a query containing `websearch_to_tsquery`,
          // the vector branch contains `<=>`. We discriminate by inspecting
          // the tagged-template `strings.raw` joined text.
          const sql = Array.isArray(parts) ? parts.join('?') : String(parts)
          if (sql.includes('<=>')) {
            // Shouldn't be reached — vector path throws via embedText mock
            // before SQL fires. Return [] defensively.
            return []
          }
          return ftsRows
        }),
      },
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    vi.doMock('../embedClient.js', () => ({
      embedText: vi.fn(async () => { throw embedError }),
      toPgVectorLiteral: vi.fn(() => '[0]'),
    }))
    return await import('../helpService.js')
  }

  it('falls back to FTS-only when embedText throws (5xx)', async () => {
    const ftsHits = [{ id: 'c1', docId: 'd1', position: 0, content: 'training a quick bot', rank: 0.5 }]
    const { search } = await setupDegradedScenario({
      embedError: new Error('openai embed 503: service unavailable'),
      ftsRows: ftsHits,
    })
    const r = await search('how do I train a bot')
    expect(r.degraded).toBe(true)
    expect(r.degradedReason).toMatch(/openai embed 503/)
    expect(r.chunks).toHaveLength(1)
    expect(r.chunks[0].id).toBe('c1')
    // With vector branch absent, the effective alpha snaps to 1 so the
    // single FTS hit gets a non-zero score.
    expect(r.alpha).toBe(1)
    expect(r.counts.fts).toBe(1)
    expect(r.counts.vec).toBe(0)
  })

  it('truncates degradedReason to 200 chars', async () => {
    const long = 'x'.repeat(500)
    const { search } = await setupDegradedScenario({
      embedError: new Error(long),
      ftsRows: [],
    })
    const r = await search('q')
    expect(r.degraded).toBe(true)
    expect(r.degradedReason.length).toBeLessThanOrEqual(200)
  })

  it('still returns empty chunks (not throwing) when fallback yields nothing', async () => {
    const { search } = await setupDegradedScenario({
      embedError: new Error('network down'),
      ftsRows: [],
    })
    const r = await search('asdfqwerty')
    expect(r.degraded).toBe(true)
    expect(r.chunks).toEqual([])
  })

  it('handles RateLimitError-shaped errors identically to other errors', async () => {
    class RateLimitError extends Error { constructor(m) { super(m); this.name = 'RateLimitError' } }
    const { search } = await setupDegradedScenario({
      embedError: new RateLimitError('openai embed 429'),
      ftsRows: [{ id: 'c1', docId: 'd1', position: 0, content: 'x', rank: 0.1 }],
    })
    const r = await search('q')
    expect(r.degraded).toBe(true)
    expect(r.degradedReason).toMatch(/429/)
  })

  it('FTS-branch failure propagates (not a "degraded" condition)', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        // Both fts and vector queries hit $queryRaw; throwing here covers
        // the fts branch since the vector branch's embed step throws first.
        // We force fts failure by throwing on EVERY $queryRaw call.
        $queryRaw: vi.fn(async () => { throw new Error('DB connection lost') }),
      },
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    vi.doMock('../embedClient.js', () => ({
      embedText: vi.fn(async () => new Array(384).fill(0)),
      toPgVectorLiteral: vi.fn(() => '[0]'),
    }))
    const { search } = await import('../helpService.js')
    await expect(search('q')).rejects.toThrow(/DB connection lost/)
  })
})

// ── ask() — Sprint 2 §2.3 ────────────────────────────────────────────────
//
// These tests mock both helpService.search (so chunks are deterministic) and
// chatClient.streamChatCompletion (so we can pin token output + simulate
// upstream failures). DB calls go through a vi.fn shim per case.

describe('ask() — happy path + plumbing', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function setupAsk({
    chatGenerator = async function* () {
      yield 'Hello '
      yield 'world.'
    },
    searchResult = {
      chunks: [{ id: 'c1', docId: 'd1', position: 0, content: 'src', score: 0.9, ftsScore: 0.5, cosScore: 0.8 }],
      alpha: 0.4,
      counts: { fts: 1, vec: 1, merged: 1 },
      degraded: false,
      degradedReason: null,
    },
    helpQueryCreate = vi.fn(async () => ({ id: 'q-1' })),
    helpQueryUpdate = vi.fn(async () => ({})),
    helpAnswerCreate = vi.fn(async () => ({ id: 'a-1' })),
  } = {}) {
    const chatModule = {
      streamChatCompletion: vi.fn(() => chatGenerator()),
      currentChatModelVersion: vi.fn(() => 'stub:chat'),
      RateLimitError: class extends Error {
        constructor(m, r) { super(m); this.name = 'RateLimitError'; this.retryAfter = r }
      },
    }
    vi.doMock('../chatClient.js', () => chatModule)

    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async () => []),
        helpQuery: { create: helpQueryCreate, update: helpQueryUpdate },
        helpAnswer: { create: helpAnswerCreate },
      },
    }))
    vi.doMock('../../../logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }))
    const svc = await import('../helpService.js')
    // Use the injectable test seam (`_search`) rather than monkey-patching
    // the module export (ESM exports are read-only).
    const searchStub = vi.fn(async () => searchResult)
    return { svc, chatModule, helpQueryCreate, helpQueryUpdate, helpAnswerCreate, searchStub }
  }

  async function collectAsk(gen) {
    const frames = []
    for await (const f of gen) frames.push(f)
    return frames
  }

  it('emits token frames then a done frame', async () => {
    const { svc, helpQueryCreate, helpAnswerCreate, searchStub } = await setupAsk()
    const frames = await collectAsk(svc.ask({
      question: 'how do I train a bot',
      userId:   'u-1',
      context:  { route: '/x' },
      _search:  searchStub,
    }))
    expect(frames[0]).toEqual({ kind: 'token', text: 'Hello ' })
    expect(frames[1]).toEqual({ kind: 'token', text: 'world.' })
    expect(frames.at(-1).kind).toBe('done')
    expect(frames.at(-1).answerId).toBe('a-1')
    expect(frames.at(-1).contentFilterTriggered).toBe(false)
    expect(frames.at(-1).rendered).toBe('Hello world.')
    expect(helpQueryCreate).toHaveBeenCalledTimes(1)
    expect(helpAnswerCreate).toHaveBeenCalledTimes(1)
  })

  it('persists HelpQuery with retrieval metadata + degraded flag', async () => {
    const { svc, helpQueryCreate, searchStub } = await setupAsk({
      searchResult: {
        chunks: [{ id: 'c1', content: 'x', score: 0.5, ftsScore: 0.3, cosScore: null }],
        alpha: 1.0,
        counts: { fts: 1, vec: 0, merged: 1 },
        degraded: true,
        degradedReason: 'openai embed 503',
      },
    })
    await collectAsk(svc.ask({ question: 'q', userId: 'u-1', _search: searchStub }))
    const data = helpQueryCreate.mock.calls[0][0].data
    expect(data.text).toBe('q')
    expect(data.userId).toBe('u-1')
    expect(data.retrievedChunkIds).toEqual(['c1'])
    expect(data.retrievalScore.c1).toEqual({ fts: 0.3, vector: null, hybrid: 0.5 })
    expect(data.degraded).toBe(true)
    expect(data.degradedReason).toBe('openai embed 503')
    expect(data.promptTemplate).toBe('help.v1')
    expect(data.modelVersion).toBe('stub:chat')
  })

  it('returns error frame on empty question', async () => {
    const { svc, searchStub } = await setupAsk()
    const frames = await collectAsk(svc.ask({ question: '   ', userId: 'u-1', _search: searchStub }))
    expect(frames).toEqual([{ kind: 'error', error: 'empty_question' }])
  })

  it('emits done frame even if HelpAnswer persistence fails (answer already streamed)', async () => {
    const { svc, helpAnswerCreate, searchStub } = await setupAsk({
      helpAnswerCreate: vi.fn(async () => { throw new Error('db down') }),
    })
    const frames = await collectAsk(svc.ask({ question: 'q', userId: 'u-1', _search: searchStub }))
    // Tokens still flow
    expect(frames.find(f => f.kind === 'token')).toBeTruthy()
    // Done frame still emitted (answerId is null because create failed)
    const done = frames.at(-1)
    expect(done.kind).toBe('done')
    expect(done.answerId).toBeNull()
    expect(helpAnswerCreate).toHaveBeenCalled()
  })
})

describe('ask() — content filter (§2.7)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('replaces rendered with refusal when filter triggers', async () => {
    // The actual contentFilter denylist includes ASCII slurs; we'll use one
    // that's in the real list (lower-cased common slur sample). The model
    // would never emit this in production with our prompt; the test is just
    // verifying the filter wiring fires when content matches.
    vi.doMock('../chatClient.js', () => ({
      streamChatCompletion: vi.fn(async function* () { yield 'this contains retard somewhere' }),
      currentChatModelVersion: vi.fn(() => 'stub:chat'),
      RateLimitError: class extends Error {},
    }))
    const create = vi.fn()
      .mockResolvedValueOnce({ id: 'q-1' })
    const ansCreate = vi.fn(async () => ({ id: 'a-1' }))
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async () => []),
        helpQuery:  { create, update: vi.fn() },
        helpAnswer: { create: ansCreate },
      },
    }))
    vi.doMock('../../../logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }))
    const svc = await import('../helpService.js')
    const searchStub = vi.fn(async () => ({
      chunks: [],
      alpha: 0.4,
      counts: { fts: 0, vec: 0, merged: 0 },
      degraded: false,
      degradedReason: null,
    }))

    const frames = []
    for await (const f of svc.ask({ question: 'q', userId: 'u-1', _search: searchStub })) frames.push(f)
    const done = frames.at(-1)
    expect(done.contentFilterTriggered).toBe(true)
    expect(done.rendered).toMatch(/can't help with that/)
    expect(ansCreate.mock.calls[0][0].data.contentFilterTriggered).toBe(true)
    expect(ansCreate.mock.calls[0][0].data.contentFilterTerms.length).toBeGreaterThan(0)
    // The refusal — not the raw model output — is what gets persisted.
    expect(ansCreate.mock.calls[0][0].data.rendered).toMatch(/can't help/)
  })
})

describe('ask() — chat failure paths', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('emits error=llm_unavailable on chat 5xx and marks HelpQuery degraded', async () => {
    const updateMock = vi.fn(async () => ({}))
    vi.doMock('../chatClient.js', () => ({
      streamChatCompletion: vi.fn(async function* () {
        throw new Error('openai chat 503: unavailable')
      }),
      currentChatModelVersion: vi.fn(() => 'stub:chat'),
      RateLimitError: class extends Error {},
    }))
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async () => []),
        helpQuery:  { create: vi.fn(async () => ({ id: 'q-1' })), update: updateMock },
        helpAnswer: { create: vi.fn() },
      },
    }))
    vi.doMock('../../../logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }))
    const svc = await import('../helpService.js')
    const searchStub = vi.fn(async () => ({
      chunks: [], alpha: 0.4, counts: { fts: 0, vec: 0, merged: 0 },
      degraded: false, degradedReason: null,
    }))

    const frames = []
    for await (const f of svc.ask({ question: 'q', userId: 'u-1', _search: searchStub })) frames.push(f)
    const last = frames.at(-1)
    expect(last.kind).toBe('error')
    expect(last.error).toBe('llm_unavailable')
    expect(updateMock).toHaveBeenCalled()
    expect(updateMock.mock.calls[0][0].data).toMatchObject({
      degraded: true,
      degradedReason: expect.stringMatching(/openai chat 503/),
    })
  })

  it('emits error=rate_limited on chat 429 with retryAfter', async () => {
    class RL extends Error { constructor(m, r) { super(m); this.name = 'RateLimitError'; this.retryAfter = r } }
    vi.doMock('../chatClient.js', () => ({
      streamChatCompletion: vi.fn(async function* () { throw new RL('openai chat 429', 9) }),
      currentChatModelVersion: vi.fn(() => 'stub:chat'),
      RateLimitError: RL,
    }))
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async () => []),
        helpQuery:  { create: vi.fn(async () => ({ id: 'q-1' })), update: vi.fn() },
        helpAnswer: { create: vi.fn() },
      },
    }))
    vi.doMock('../../../logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }))
    const svc = await import('../helpService.js')
    const searchStub = vi.fn(async () => ({
      chunks: [], alpha: 0.4, counts: { fts: 0, vec: 0, merged: 0 },
      degraded: false, degradedReason: null,
    }))

    const frames = []
    for await (const f of svc.ask({ question: 'q', userId: 'u-1', _search: searchStub })) frames.push(f)
    const last = frames.at(-1)
    expect(last.kind).toBe('error')
    expect(last.error).toBe('rate_limited')
    expect(last.retryAfter).toBe(9)
  })

  it('emits error=internal when HelpQuery insert fails', async () => {
    vi.doMock('../chatClient.js', () => ({
      streamChatCompletion: vi.fn(),
      currentChatModelVersion: vi.fn(() => 'stub:chat'),
      RateLimitError: class extends Error {},
    }))
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async () => []),
        helpQuery:  { create: vi.fn(async () => { throw new Error('db down') }), update: vi.fn() },
        helpAnswer: { create: vi.fn() },
      },
    }))
    vi.doMock('../../../logger.js', () => ({
      default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }))
    const svc = await import('../helpService.js')
    const searchStub = vi.fn(async () => ({
      chunks: [], alpha: 0.4, counts: { fts: 0, vec: 0, merged: 0 },
      degraded: false, degradedReason: null,
    }))

    const frames = []
    for await (const f of svc.ask({ question: 'q', userId: 'u-1', _search: searchStub })) frames.push(f)
    expect(frames.at(-1)).toMatchObject({ kind: 'error', error: 'internal' })
  })
})

describe('getDegradedRate', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns ratio=0 when no queries in window', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        $queryRaw: vi.fn(async () => [{ total: 0, degraded: 0 }]),
      },
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { getDegradedRate } = await import('../helpService.js')
    const r = await getDegradedRate(60)
    expect(r).toEqual({
      windowMinutes:    60,
      totalQueries:     0,
      degradedQueries:  0,
      ratio:            0,
    })
  })

  it('computes ratio when both columns populated', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        $queryRaw: vi.fn(async () => [{ total: 100, degraded: 25 }]),
      },
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { getDegradedRate } = await import('../helpService.js')
    const r = await getDegradedRate(1440)
    expect(r.windowMinutes).toBe(1440)
    expect(r.totalQueries).toBe(100)
    expect(r.degradedQueries).toBe(25)
    expect(r.ratio).toBe(0.25)
  })
})
