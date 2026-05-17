// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the nightly research-log export job — Sprint 3 of
 * doc/Research_Log_Plan.md §3.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  notesFindMany:   async () => [],
  entriesFindMany: async () => [],
  createMany:      vi.fn(async () => ({ count: 0 })),
  executeRaw:      vi.fn(async () => 0),
  txImpl:          async (fn) => fn({
    $executeRawUnsafe: mocks.executeRaw,
    researchLogExport: { createMany: mocks.createMany },
  }),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    trainingSessionNote: { findMany: (...a) => mocks.notesFindMany(...a) },
    researchLogEntry:    { findMany: (...a) => mocks.entriesFindMany(...a) },
    $transaction:        (fn) => mocks.txImpl(fn),
  },
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  runResearchLogExport,
  _resetResearchLogExportState,
  _tickForTest,
} from '../researchLogExport.js'

beforeEach(() => {
  _resetResearchLogExportState()
  mocks.notesFindMany   = async () => []
  mocks.entriesFindMany = async () => []
  mocks.createMany.mockReset().mockResolvedValue({ count: 0 })
  mocks.executeRaw.mockReset().mockResolvedValue(0)
})

describe('runResearchLogExport', () => {
  it('truncates then inserts notes + entries with the discriminator stamped', async () => {
    mocks.notesFindMany = async () => [
      {
        id: 'n1', userId: 'u1', body: 'note body', outcome: 'SUCCESS',
        tags: ['lr'], sharedWithCommunity: false, publishedAt: null,
        helpDocId: null,
        createdAt: new Date('2026-05-01T00:00:00Z'),
        updatedAt: new Date('2026-05-01T00:00:00Z'),
      },
    ]
    mocks.entriesFindMany = async () => [
      {
        id: 'e1', userId: 'u1', body: 'entry body',
        title: 'plateau retro', category: 'RETROSPECTIVE',
        tags: ['retro'], sharedWithCommunity: true,
        publishedAt: new Date('2026-05-05T00:00:00Z'),
        helpDocId: 'doc_a',
        createdAt: new Date('2026-05-05T00:00:00Z'),
        updatedAt: new Date('2026-05-05T00:00:00Z'),
      },
    ]

    const result = await runResearchLogExport()
    expect(result).toEqual({ noteCount: 1, entryCount: 1, totalCount: 2, elapsedMs: expect.any(Number) })

    // TRUNCATE fired exactly once.
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    expect(mocks.executeRaw.mock.calls[0][0]).toMatch(/TRUNCATE TABLE "research_log_exports"/)

    // createMany received both rows with the right discriminators + id prefixes.
    expect(mocks.createMany).toHaveBeenCalledTimes(1)
    const rows = mocks.createMany.mock.calls[0][0].data
    expect(rows).toHaveLength(2)
    const note = rows.find(r => r.type === 'note')
    const entry = rows.find(r => r.type === 'entry')
    expect(note.id).toBe('note:n1')
    expect(note.outcome).toBe('SUCCESS')
    expect(note.title).toBeNull()
    expect(note.category).toBeNull()
    expect(entry.id).toBe('entry:e1')
    expect(entry.title).toBe('plateau retro')
    expect(entry.category).toBe('RETROSPECTIVE')
    expect(entry.outcome).toBeNull()
    expect(entry.helpDocId).toBe('doc_a')
  })

  it('skips the createMany call when both source tables are empty', async () => {
    const result = await runResearchLogExport()
    expect(result.totalCount).toBe(0)
    // TRUNCATE still fires (to clear stale rows from a prior run).
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
    // createMany skipped — Prisma rejects an empty `data` array.
    expect(mocks.createMany).not.toHaveBeenCalled()
  })

  it('preserves tags + community-share flag through the transform', async () => {
    mocks.notesFindMany = async () => [
      {
        id: 'n1', userId: 'u1', body: 'b', outcome: 'PLATEAU',
        tags: ['a', 'b', 'c'], sharedWithCommunity: true,
        publishedAt: new Date('2026-05-10T00:00:00Z'),
        helpDocId: 'doc_n',
        createdAt: new Date(), updatedAt: new Date(),
      },
    ]
    await runResearchLogExport()
    const row = mocks.createMany.mock.calls[0][0].data[0]
    expect(row.tags).toEqual(['a', 'b', 'c'])
    expect(row.sharedWithCommunity).toBe(true)
    expect(row.publishedAt).toBeInstanceOf(Date)
    expect(row.helpDocId).toBe('doc_n')
  })

  it('runs TRUNCATE + INSERT inside one transaction (atomic rebuild)', async () => {
    mocks.notesFindMany = async () => [
      { id: 'n1', userId: 'u1', body: 'b', outcome: 'SUCCESS', tags: [],
        sharedWithCommunity: false, publishedAt: null, helpDocId: null,
        createdAt: new Date(), updatedAt: new Date() },
    ]
    let txCount = 0
    mocks.txImpl = async (fn) => {
      txCount++
      return fn({
        $executeRawUnsafe: mocks.executeRaw,
        researchLogExport: { createMany: mocks.createMany },
      })
    }
    await runResearchLogExport()
    expect(txCount).toBe(1)
  })
})

describe('researchLogExport cron tick', () => {
  it('skips when the UTC hour is not the target hour', async () => {
    const result = await _tickForTest({
      _now: () => new Date('2026-05-16T12:00:00Z'), // noon UTC
    })
    expect(result.skipped).toBe('wrong_hour')
    expect(mocks.executeRaw).not.toHaveBeenCalled()
  })

  it('runs when the UTC hour matches the target', async () => {
    const result = await _tickForTest({
      _now: () => new Date('2026-05-16T03:15:00Z'),
    })
    expect(result.ran).toBe(true)
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
  })

  it('does not re-run twice on the same UTC date', async () => {
    const first = await _tickForTest({
      _now: () => new Date('2026-05-16T03:15:00Z'),
    })
    expect(first.ran).toBe(true)
    const second = await _tickForTest({
      _now: () => new Date('2026-05-16T03:45:00Z'),
    })
    expect(second.skipped).toBe('already_ran_today')
    // Only one TRUNCATE fired across both ticks.
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1)
  })
})
