// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tests for the Research Log community feed + markdown export.
 * Sprint 2 of doc/Research_Log_Plan.md §3 steps 5–6.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMock = {
  helpDoc: { findMany: vi.fn() },
  trainingSessionNote: { findMany: vi.fn() },
  researchLogEntry:    { findMany: vi.fn() },
}
vi.mock('../../../lib/db.js', () => ({ default: dbMock }))

const { listCommunityDocs, buildExportMarkdown } = await import('../communityService.js')

beforeEach(() => vi.clearAllMocks())

describe('listCommunityDocs', () => {
  it('filters HelpDoc by source = community-note and returns shaped items', async () => {
    dbMock.helpDoc.findMany.mockResolvedValueOnce([
      {
        id: 'd1', slug: 'research-note-n1', title: 'Plateau notes',
        body: '# Plateau notes\n\nbody', category: 'community', tags: ['lr'],
        createdAt: new Date('2026-05-10T00:00:00Z'),
        updatedAt: new Date('2026-05-10T00:00:00Z'),
        version: 1,
        owner: { id: 'u1', displayName: 'Alice' },
      },
    ])
    const result = await listCommunityDocs({})
    expect(dbMock.helpDoc.findMany.mock.calls[0][0].where.source).toBe('community-note')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].author).toEqual({ id: 'u1', displayName: 'Alice' })
    expect(result.nextCursor).toBeNull()
  })

  it('normalizes tag filter (lowercase + hyphen→underscore)', async () => {
    dbMock.helpDoc.findMany.mockResolvedValueOnce([])
    await listCommunityDocs({ tag: 'Q-Learning' })
    const where = dbMock.helpDoc.findMany.mock.calls[0][0].where
    expect(where.tags).toEqual({ has: 'q_learning' })
  })

  it('applies cursor pagination via OR clause', async () => {
    dbMock.helpDoc.findMany.mockResolvedValueOnce([])
    await listCommunityDocs({
      cursorCreatedAt: '2026-05-10T00:00:00.000Z',
      cursorId: 'd5',
    })
    const where = dbMock.helpDoc.findMany.mock.calls[0][0].where
    expect(where.OR).toBeDefined()
    expect(where.OR[0].createdAt.lt).toBeInstanceOf(Date)
    expect(where.OR[1].id).toEqual({ lt: 'd5' })
  })

  it('returns a next-cursor when page is full', async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({
      id: `d${i}`, slug: `s${i}`, title: 't', body: 'b', category: 'community',
      tags: [], createdAt: new Date(`2026-05-1${9 - i}T00:00:00Z`),
      updatedAt: new Date(), version: 1, owner: null,
    }))
    dbMock.helpDoc.findMany.mockResolvedValueOnce(rows)
    const result = await listCommunityDocs({ limit: 3 })
    expect(result.nextCursor).not.toBeNull()
    expect(result.nextCursor.id).toBe('d2')
  })

  it('returns null nextCursor on a short page', async () => {
    dbMock.helpDoc.findMany.mockResolvedValueOnce([
      { id: 'd1', slug: 's', title: 't', body: 'b', category: 'c',
        tags: [], createdAt: new Date(), updatedAt: new Date(),
        version: 1, owner: null },
    ])
    const result = await listCommunityDocs({ limit: 10 })
    expect(result.nextCursor).toBeNull()
  })

  it('handles a doc whose author was deleted (owner=null)', async () => {
    dbMock.helpDoc.findMany.mockResolvedValueOnce([
      { id: 'd1', slug: 's', title: 't', body: 'b', category: 'c',
        tags: [], createdAt: new Date(), updatedAt: new Date(),
        version: 1, owner: null },
    ])
    const result = await listCommunityDocs({})
    expect(result.items[0].author).toBeNull()
  })

  it('caps page size at the documented maximum (100)', async () => {
    dbMock.helpDoc.findMany.mockResolvedValueOnce([])
    await listCommunityDocs({ limit: 99999 })
    expect(dbMock.helpDoc.findMany.mock.calls[0][0].take).toBe(100)
  })
})

describe('buildExportMarkdown', () => {
  it('emits a header + interleaves notes and entries by createdAt desc', async () => {
    dbMock.trainingSessionNote.findMany.mockResolvedValueOnce([
      {
        id: 'n1', sessionId: 'sess_1', body: 'tried lr=3e-4',
        outcome: 'SUCCESS', tags: ['lr'], sharedWithCommunity: false,
        createdAt: new Date('2026-05-10T12:00:00Z'),
      },
    ])
    dbMock.researchLogEntry.findMany.mockResolvedValueOnce([
      {
        id: 'e1', title: 'Sprint retro', body: 'plateau hit at 20k',
        category: 'RETROSPECTIVE', tags: ['retro'], sharedWithCommunity: true,
        createdAt: new Date('2026-05-12T12:00:00Z'),
      },
    ])
    const md = await buildExportMarkdown('user_1')
    expect(md).toContain('# Research Journal Export')
    expect(md).toContain('Items: 2 (1 note, 1 entry)')
    // Entry is newer → should appear first.
    expect(md.indexOf('type: entry')).toBeLessThan(md.indexOf('type: note'))
    expect(md).toContain('outcome: SUCCESS')
    expect(md).toContain('category: RETROSPECTIVE')
    expect(md).toContain('# Sprint retro')
    expect(md).toContain('tried lr=3e-4')
  })

  it('emits a friendly placeholder when there is nothing to export', async () => {
    dbMock.trainingSessionNote.findMany.mockResolvedValueOnce([])
    dbMock.researchLogEntry.findMany.mockResolvedValueOnce([])
    const md = await buildExportMarkdown('user_1')
    expect(md).toContain('_No research entries yet._')
  })

  it('YAML-quotes titles containing special chars', async () => {
    dbMock.trainingSessionNote.findMany.mockResolvedValueOnce([])
    dbMock.researchLogEntry.findMany.mockResolvedValueOnce([
      {
        id: 'e1', title: 'plateau: 20k episodes', body: 'b',
        category: 'OBSERVATION', tags: [], sharedWithCommunity: false,
        createdAt: new Date('2026-05-10T00:00:00Z'),
      },
    ])
    const md = await buildExportMarkdown('user_1')
    expect(md).toContain('title: "plateau: 20k episodes"')
  })

  it('pluralizes correctly: 1 note, 2 entries / 2 notes, 1 entry', async () => {
    dbMock.trainingSessionNote.findMany.mockResolvedValueOnce([
      { id: 'n1', sessionId: 's', body: 'b', outcome: 'SUCCESS',
        tags: [], sharedWithCommunity: false, createdAt: new Date() },
      { id: 'n2', sessionId: 's', body: 'b', outcome: 'PLATEAU',
        tags: [], sharedWithCommunity: false, createdAt: new Date() },
    ])
    dbMock.researchLogEntry.findMany.mockResolvedValueOnce([
      { id: 'e1', title: 't', body: 'b', category: 'OTHER', tags: [],
        sharedWithCommunity: false, createdAt: new Date() },
    ])
    const md = await buildExportMarkdown('user_1')
    expect(md).toContain('Items: 3 (2 notes, 1 entry)')
  })
})
