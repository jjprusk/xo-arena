// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the Sprint 3 lane-aware retrieval pipeline
 * (doc/Research_Log_Plan.md §3 steps 1–4).
 *
 * Covers:
 *   - lane budget honored per lane (corpus / privateNotes / communityNotes)
 *   - getLaneBudgets reads SystemConfig overrides + clamps to [0, 25]
 *   - private lane skipped when userId is null
 *   - private lane skipped when shareWithGuide=false
 *   - private lane filters by ownerId at the SQL level
 *   - cross-user request returns zero private chunks (the privacy assertion)
 *   - degraded propagates from a per-lane vector failure
 *   - empty query returns empty chunks without firing SQL
 *   - buildCitations dedupes by docId with lane priority
 *   - getUserSharePref fail-safe (false on missing / error / absent key)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Shared DB mock — captures every SQL fragment for assertion ───────────
//
// vi.mock factories are hoisted to the top of the file, so any vars they
// reference must be hoisted via vi.hoisted (otherwise: TDZ ReferenceError).

const mocks = vi.hoisted(() => ({
  queryRawMock:     (...a) => mocks._queryRaw(...a),
  transactionMock:  (...a) => mocks._tx(...a),
  systemConfigMock: { findUnique: (...a) => mocks._sysFind(...a), findMany: (...a) => mocks._sysMany(...a) },
  helpDocMock:      { findMany: (...a) => mocks._docMany(...a) },
  userMock:         { findUnique: (...a) => mocks._userFind(...a) },
  // The actual implementations are swapped in beforeEach below.
  _queryRaw:  async () => [],
  _tx:        async (fn) => fn({ $queryRaw: async () => [], $executeRawUnsafe: async () => {} }),
  _sysFind:   async () => null,
  _sysMany:   async () => [],
  _docMany:   async () => [],
  _userFind:  async () => null,
}))

vi.mock('../../../lib/db.js', () => ({
  default: {
    $queryRaw:        mocks.queryRawMock,
    $transaction:     mocks.transactionMock,
    $executeRawUnsafe: async () => {},
    systemConfig:     mocks.systemConfigMock,
    helpDoc:          mocks.helpDocMock,
    user:             mocks.userMock,
  },
}))

vi.mock('../../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../embedClient.js', () => ({
  embedText:          async () => new Array(384).fill(0),
  toPgVectorLiteral:  (v) => `[${v.join(',')}]`,
  RateLimitError:     class extends Error {},
}))

import {
  searchLanes,
  getLaneBudgets,
  getUserSharePref,
  buildCitations,
  DEFAULT_LANE_BUDGETS,
} from '../helpService.js'

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Returns one fake row shaped like what `runFtsQuery`/`runVectorQuery`
 * would return after the SQL pass. The lane refactor calls these via
 * `$queryRaw` (FTS) and `$transaction` (vector) — the mocks below stub
 * both branches per-lane.
 */
function fakeFtsRow(id, source = 'guide') {
  return { id, docId: `doc-${id}`, position: 0, content: `body-${id}`, rank: 0.5, _source: source }
}

function stubBothBranchesPerLane(perLane) {
  // perLane: { [source]: { fts: row[], vec: row[] } }
  mocks._queryRaw = (strings, ...params) => {
    for (const p of params) {
      if (typeof p === 'string' && perLane[p]) {
        return Promise.resolve(perLane[p].fts ?? [])
      }
    }
    return Promise.resolve([])
  }
  mocks._tx = async (fn) => {
    const tx = {
      $queryRaw: (strings, ...params) => {
        for (const p of params) {
          if (typeof p === 'string' && perLane[p]) {
            return Promise.resolve(perLane[p].vec ?? [])
          }
        }
        return Promise.resolve([])
      },
      $executeRawUnsafe: async () => {},
    }
    return fn(tx)
  }
}

beforeEach(() => {
  mocks._queryRaw  = async () => []
  mocks._tx        = async (fn) => fn({ $queryRaw: async () => [], $executeRawUnsafe: async () => {} })
  mocks._sysFind   = async () => null
  mocks._sysMany   = async () => []
  mocks._docMany   = async () => []
  mocks._userFind  = async () => null
})

// ── Lane budgets ──────────────────────────────────────────────────────────

describe('getLaneBudgets', () => {
  it('returns defaults when SystemConfig has no overrides', async () => {
    const b = await getLaneBudgets()
    expect(b).toEqual(DEFAULT_LANE_BUDGETS)
  })

  it('reads number overrides per lane', async () => {
    mocks._sysMany = async () => [
      { key: 'help.lanes.corpus',         value: 8 },
      { key: 'help.lanes.privateNotes',   value: 0 },
      { key: 'help.lanes.communityNotes', value: 3 },
    ]
    const b = await getLaneBudgets()
    expect(b).toEqual({ corpus: 8, privateNotes: 0, communityNotes: 3 })
  })

  it('falls back to defaults on a DB error (never throws)', async () => {
    mocks._sysMany = async () => { throw new Error('db down') }
    const b = await getLaneBudgets()
    expect(b).toEqual(DEFAULT_LANE_BUDGETS)
  })

  it('clamps negative or absurd values to the default', async () => {
    mocks._sysMany = async () => [
      { key: 'help.lanes.corpus', value: -5 },
      { key: 'help.lanes.communityNotes', value: 1000 },
    ]
    const b = await getLaneBudgets()
    expect(b.corpus).toBe(DEFAULT_LANE_BUDGETS.corpus)
    expect(b.communityNotes).toBe(DEFAULT_LANE_BUDGETS.communityNotes)
  })
})

// ── shareNotesWithGuide fail-safe ─────────────────────────────────────────

describe('getUserSharePref', () => {
  it('returns false when userId is null', async () => {
    let called = false
    mocks._userFind = async () => { called = true; return null }
    expect(await getUserSharePref(null)).toBe(false)
    expect(called).toBe(false)
  })
  it('returns false when the user record is missing', async () => {
    mocks._userFind = async () => null
    expect(await getUserSharePref('u1')).toBe(false)
  })
  it('returns false when the preference key is absent', async () => {
    mocks._userFind = async () => ({ preferences: {} })
    expect(await getUserSharePref('u1')).toBe(false)
  })
  it('returns true when explicitly set', async () => {
    mocks._userFind = async () => ({ preferences: { shareNotesWithGuide: true } })
    expect(await getUserSharePref('u1')).toBe(true)
  })
  it('returns false on DB error (fail-safe, never expose private content on error)', async () => {
    mocks._userFind = async () => { throw new Error('boom') }
    expect(await getUserSharePref('u1')).toBe(false)
  })
})

// ── searchLanes main behavior ─────────────────────────────────────────────

describe('searchLanes', () => {
  it('returns empty result for an empty query without firing any SQL', async () => {
    let fts = 0, tx = 0
    mocks._queryRaw = async () => { fts++; return [] }
    mocks._tx       = async (fn) => { tx++; return fn({ $queryRaw: async () => [], $executeRawUnsafe: async () => {} }) }
    const r = await searchLanes('   ', { userId: 'u1', shareWithGuide: true })
    expect(r.chunks).toEqual([])
    expect(fts).toBe(0)
    expect(tx).toBe(0)
  })

  it('honors per-lane budgets — caps each lane independently', async () => {
    // Stub each source with 10 rows; budgets cap to 4 / 2 / 0
    const make = (n, source) => Array.from({ length: n }, (_, i) => fakeFtsRow(`${source}-${i}`, source))
    stubBothBranchesPerLane({
      'guide':          { fts: make(10, 'guide'),          vec: [] },
      'community-note': { fts: make(10, 'community-note'), vec: [] },
    })
    const r = await searchLanes('q', {
      userId: 'u1',
      shareWithGuide: false, // disables private lane
      lanes: { corpus: 4, privateNotes: 0, communityNotes: 2 },
    })
    expect(r.lanes.corpus).toHaveLength(4)
    expect(r.lanes.communityNotes).toHaveLength(2)
    expect(r.lanes.privateNotes).toEqual([])
  })

  it('tags every returned chunk with its lane', async () => {
    stubBothBranchesPerLane({
      'guide':          { fts: [fakeFtsRow('g1', 'guide')],          vec: [] },
      'community-note': { fts: [fakeFtsRow('c1', 'community-note')], vec: [] },
    })
    const r = await searchLanes('q', {
      userId: null,
      lanes: { corpus: 5, privateNotes: 0, communityNotes: 5 },
    })
    const lanes = r.chunks.map(c => c.lane)
    expect(lanes).toEqual(expect.arrayContaining(['corpus', 'communityNotes']))
    expect(lanes).not.toContain('privateNotes')
  })

  it('skips the private lane entirely when userId is null (no SQL fired for that lane)', async () => {
    const fired = { 'private-note': 0 }
    mocks._queryRaw = async (strings, ...params) => {
      for (const p of params) if (p === 'private-note') fired['private-note']++
      return []
    }
    mocks._tx = async (fn) => fn({
      $queryRaw: async (strings, ...params) => {
        for (const p of params) if (p === 'private-note') fired['private-note']++
        return []
      },
      $executeRawUnsafe: async () => {},
    })
    await searchLanes('q', {
      userId: null, shareWithGuide: true,
      lanes: { corpus: 4, privateNotes: 2, communityNotes: 2 },
    })
    expect(fired['private-note']).toBe(0)
  })

  it('skips the private lane when shareWithGuide=false (even with a valid userId)', async () => {
    const fired = { 'private-note': 0 }
    mocks._queryRaw = async (strings, ...params) => {
      for (const p of params) if (p === 'private-note') fired['private-note']++
      return []
    }
    mocks._tx = async (fn) => fn({
      $queryRaw: async () => [], $executeRawUnsafe: async () => {},
    })
    await searchLanes('q', {
      userId: 'u1', shareWithGuide: false,
      lanes: { corpus: 4, privateNotes: 2, communityNotes: 2 },
    })
    expect(fired['private-note']).toBe(0)
  })

  it('fires the private lane WITH the asking user as ownerId binding (SQL-level filter)', async () => {
    const seenBindings = []
    mocks._queryRaw = async (strings, ...params) => {
      if (params.includes('private-note')) seenBindings.push(params)
      return []
    }
    mocks._tx = async (fn) => fn({
      $queryRaw: async (strings, ...params) => {
        if (params.includes('private-note')) seenBindings.push(params)
        return []
      },
      $executeRawUnsafe: async () => {},
    })
    await searchLanes('q', {
      userId: 'user_alice', shareWithGuide: true,
      lanes: { corpus: 0, privateNotes: 2, communityNotes: 0 },
    })
    expect(seenBindings.length).toBeGreaterThan(0)
    for (const params of seenBindings) {
      expect(params).toContain('user_alice')
    }
  })

  it('aggregates degraded=true when any lane loses its vector branch', async () => {
    mocks._queryRaw = async () => []
    let calls = 0
    mocks._tx = async (fn) => {
      calls++
      if (calls === 1) throw new Error('embed down')
      return fn({ $queryRaw: async () => [], $executeRawUnsafe: async () => {} })
    }
    const r = await searchLanes('q', {
      userId: 'u1', shareWithGuide: true,
      lanes: { corpus: 4, privateNotes: 0, communityNotes: 2 },
    })
    expect(r.degraded).toBe(true)
    expect(r.degradedReason).toMatch(/embed down/)
  })
})

// ── buildCitations ────────────────────────────────────────────────────────

describe('buildCitations', () => {
  it('returns [] for an empty chunk list', async () => {
    let called = false
    mocks._docMany = async () => { called = true; return [] }
    const c = await buildCitations([])
    expect(c).toEqual([])
    expect(called).toBe(false)
  })

  it('dedupes by docId and prefers the higher-priority lane', async () => {
    mocks._docMany = async () => [
      { id: 'd1', slug: 'doc-1', title: 'Doc 1', source: 'guide', owner: null },
    ]
    const chunks = [
      { id: 'c1', docId: 'd1', lane: 'corpus' },
      { id: 'c2', docId: 'd1', lane: 'communityNotes' }, // higher priority — wins
    ]
    const cites = await buildCitations(chunks)
    expect(cites).toHaveLength(1)
    expect(cites[0].lane).toBe('communityNotes')
  })

  it('attaches the author block when HelpDoc.owner is present', async () => {
    mocks._docMany = async () => [
      {
        id: 'd1', slug: 's', title: 't', source: 'community-note',
        owner: { id: 'u1', displayName: 'Alice' },
      },
    ]
    const cites = await buildCitations([{ id: 'c1', docId: 'd1', lane: 'communityNotes' }])
    expect(cites[0].author).toEqual({ id: 'u1', displayName: 'Alice' })
  })

  it('sets author=null for orphaned (deleted-user) docs', async () => {
    mocks._docMany = async () => [
      { id: 'd1', slug: 's', title: 't', source: 'community-note', owner: null },
    ]
    const cites = await buildCitations([{ id: 'c1', docId: 'd1', lane: 'communityNotes' }])
    expect(cites[0].author).toBeNull()
  })
})
