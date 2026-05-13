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
})
