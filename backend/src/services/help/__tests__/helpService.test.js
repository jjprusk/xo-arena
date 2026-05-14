/**
 * Unit tests for helpService — the SQL paths are exercised by 1.11
 * acceptance against a real DB. Here we cover `mergeRanked` (pure) and
 * basic shape of `search` via mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergeRanked } from '../helpService.js'

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
    const fts = [
      { id: 'a', docId: 'd', position: 0, content: 'a', ftsScore: 1.0, cosScore: null },
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
    const fts = [
      { id: 'a', docId: 'd', position: 0, content: 'a', ftsScore: 0.0001, cosScore: null },
    ]
    const vec = [
      { id: 'b', docId: 'd', position: 1, content: 'b', ftsScore: null, cosScore: 0.9 },
    ]
    const merged = mergeRanked(fts, vec, 0.5)
    const a = merged.find(r => r.id === 'a')
    const b = merged.find(r => r.id === 'b')
    // After normalization, both should have score ≈ 0.5
    expect(a.score).toBeCloseTo(0.5, 5)
    expect(b.score).toBeCloseTo(0.5, 5)
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

  it('falls back to default α when SystemConfig is missing', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async () => []),
      },
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { search } = await import('../helpService.js')
    const r = await search('anything')
    expect(r.alpha).toBe(0.4)
  })

  it('clamps α from SystemConfig to [0, 1]', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => ({ value: 2.5 })) },
        $queryRaw: vi.fn(async () => []),
      },
    }))
    vi.doMock('../../../logger.js', () => ({ default: { warn: vi.fn(), info: vi.fn() } }))
    const { search } = await import('../helpService.js')
    const r = await search('q')
    expect(r.alpha).toBe(1)
  })

  it('reports degraded=false when both branches succeed', async () => {
    vi.doMock('../../../lib/db.js', () => ({
      default: {
        systemConfig: { findUnique: vi.fn(async () => null) },
        $queryRaw: vi.fn(async () => []),
      },
    }))
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
