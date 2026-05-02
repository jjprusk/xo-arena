// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Belt-and-suspenders janitor for `isTest=true` tournament_templates and
 * tournaments older than 24h (Guard B). Verifies:
 *   - cutoff applied on updatedAt
 *   - dependent rows deleted/nulled in the right order so the tournament
 *     delete doesn't trip an FK constraint
 *   - templates swept independently of tournaments
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: {
    tournament:            { findMany: vi.fn(), deleteMany: vi.fn() },
    tournamentTemplate:    { deleteMany: vi.fn() },
    game:                  { deleteMany: vi.fn() },
    table:                 { deleteMany: vi.fn() },
    meritTransaction:      { updateMany: vi.fn() },
    classificationHistory: { updateMany: vi.fn() },
  },
}))
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { sweepStaleTestRows } = await import('../testJanitor.js')
const db = (await import('../db.js')).default

beforeEach(() => {
  vi.clearAllMocks()
  db.tournament.findMany.mockResolvedValue([])
  db.tournament.deleteMany.mockResolvedValue({ count: 0 })
  db.tournamentTemplate.deleteMany.mockResolvedValue({ count: 0 })
  db.game.deleteMany.mockResolvedValue({ count: 0 })
  db.table.deleteMany.mockResolvedValue({ count: 0 })
  db.meritTransaction.updateMany.mockResolvedValue({ count: 0 })
  db.classificationHistory.updateMany.mockResolvedValue({ count: 0 })
})

describe('sweepStaleTestRows', () => {
  it('applies a 24h cutoff on updatedAt', async () => {
    const now = new Date('2026-05-01T12:00:00.000Z')
    await sweepStaleTestRows(now)
    const tournamentWhere = db.tournament.findMany.mock.calls[0][0].where
    expect(tournamentWhere.isTest).toBe(true)
    expect(tournamentWhere.updatedAt.lt.getTime()).toBe(now.getTime() - 24 * 60 * 60 * 1000)

    const templateWhere = db.tournamentTemplate.deleteMany.mock.calls[0][0].where
    expect(templateWhere.isTest).toBe(true)
    expect(templateWhere.updatedAt.lt.getTime()).toBe(now.getTime() - 24 * 60 * 60 * 1000)
  })

  it('deletes Game / Table rows BEFORE tournament rows (FK ordering)', async () => {
    db.tournament.findMany.mockResolvedValue([{ id: 't_old' }])
    db.tournament.deleteMany.mockResolvedValue({ count: 1 })

    await sweepStaleTestRows()

    const gameOrder       = db.game.deleteMany.mock.invocationCallOrder[0]
    const tableOrder      = db.table.deleteMany.mock.invocationCallOrder[0]
    const tournamentOrder = db.tournament.deleteMany.mock.invocationCallOrder[0]

    expect(gameOrder).toBeLessThan(tournamentOrder)
    expect(tableOrder).toBeLessThan(tournamentOrder)
  })

  it('nulls out (not deletes) MeritTransaction.tournamentId and ClassificationHistory.tournamentId', async () => {
    db.tournament.findMany.mockResolvedValue([{ id: 't_old' }])
    db.tournament.deleteMany.mockResolvedValue({ count: 1 })

    await sweepStaleTestRows()

    expect(db.meritTransaction.updateMany).toHaveBeenCalledWith({
      where: { tournamentId: { in: ['t_old'] } },
      data:  { tournamentId: null },
    })
    expect(db.classificationHistory.updateMany).toHaveBeenCalledWith({
      where: { tournamentId: { in: ['t_old'] } },
      data:  { tournamentId: null },
    })
  })

  it('returns counts so the sweep can log them', async () => {
    db.tournament.findMany.mockResolvedValue([{ id: 't_old' }])
    db.tournament.deleteMany.mockResolvedValue({ count: 1 })
    db.tournamentTemplate.deleteMany.mockResolvedValue({ count: 3 })
    db.game.deleteMany.mockResolvedValue({ count: 5 })
    db.table.deleteMany.mockResolvedValue({ count: 2 })

    const r = await sweepStaleTestRows()
    expect(r).toEqual({ tournaments: 1, templates: 3, games: 5, tables: 2 })
  })

  it('skips child-row deletion when no tournaments matched', async () => {
    db.tournament.findMany.mockResolvedValue([])
    await sweepStaleTestRows()
    expect(db.game.deleteMany).not.toHaveBeenCalled()
    expect(db.table.deleteMany).not.toHaveBeenCalled()
    expect(db.tournament.deleteMany).not.toHaveBeenCalled()
    // Templates still swept — their cleanup is independent.
    expect(db.tournamentTemplate.deleteMany).toHaveBeenCalledTimes(1)
  })
})
