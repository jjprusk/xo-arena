// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 4 — sweepOldCups (Curriculum Cup 30-day retention, §5.4).
 *
 * Tests cover:
 *   - 30-day cutoff applied on tournament.createdAt
 *   - cup-clone bots (`bot-cup-*`) deleted alongside the tournament
 *   - non-cup-clone participants left alone (e.g., the user's own bot)
 *   - empty result when no cups match
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: {
    tournament:   { findMany: vi.fn(), deleteMany: vi.fn() },
    user:         { deleteMany: vi.fn() },
    // Sprint 6 — sweepOldCups now reads guide.cup.retentionDays from
    // SystemConfig (with a 30-day fallback). Default mock returns null →
    // fallback applies → existing 30-day assertions stay valid.
    systemConfig: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock('../redis.js', () => ({ publish: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { sweepOldCups } = await import('../tournamentSweep.js')
const db = (await import('../db.js')).default

beforeEach(() => {
  vi.clearAllMocks()
  db.tournament.findMany.mockResolvedValue([])
  db.tournament.deleteMany.mockResolvedValue({ count: 0 })
  db.user.deleteMany.mockResolvedValue({ count: 0 })
})

describe('sweepOldCups', () => {
  it('returns zeros when no cups are over the retention threshold', async () => {
    const r = await sweepOldCups()
    expect(r).toEqual({ tournaments: 0, bots: 0 })
    expect(db.tournament.deleteMany).not.toHaveBeenCalled()
    expect(db.user.deleteMany).not.toHaveBeenCalled()
  })

  it('applies a 30-day cutoff on tournament.createdAt', async () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    await sweepOldCups(now)
    expect(db.tournament.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isCup:     true,
        createdAt: { lt: expect.any(Date) },
      }),
    }))
    const cutoff = db.tournament.findMany.mock.calls[0][0].where.createdAt.lt
    // 30 days before "now"
    const expected = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    expect(cutoff.getTime()).toBe(expected.getTime())
  })

  it('deletes the cup tournaments and the cup-clone bots they brought', async () => {
    db.tournament.findMany.mockResolvedValue([
      {
        id: 'cup-old-1',
        participants: [
          { user: { id: 'user-mine',     username: 'jpru' } },               // user, keep
          { user: { id: 'bot-cup-x-aaa', username: 'bot-cup-rusted-aaa' } }, // cup clone, delete
          { user: { id: 'bot-cup-x-bbb', username: 'bot-cup-rusted-bbb' } },
          { user: { id: 'bot-cup-x-ccc', username: 'bot-cup-copper-ccc' } },
        ],
      },
      {
        id: 'cup-old-2',
        participants: [
          { user: { id: 'user-other',    username: 'other-user' } },         // user, keep
          { user: { id: 'bot-cup-y-ddd', username: 'bot-cup-flaking-ddd' } },
        ],
      },
    ])
    db.tournament.deleteMany.mockResolvedValue({ count: 2 })
    db.user.deleteMany.mockResolvedValue({ count: 4 })

    const r = await sweepOldCups()
    expect(r).toEqual({ tournaments: 2, bots: 4 })

    expect(db.tournament.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['cup-old-1', 'cup-old-2'] } },
    })

    const userDeleteIds = db.user.deleteMany.mock.calls[0][0].where.id.in
    expect(new Set(userDeleteIds)).toEqual(new Set([
      'bot-cup-x-aaa', 'bot-cup-x-bbb', 'bot-cup-x-ccc', 'bot-cup-y-ddd',
    ]))
    // human users not in the delete set
    expect(userDeleteIds).not.toContain('user-mine')
    expect(userDeleteIds).not.toContain('user-other')
  })

  it('skips user.deleteMany when no cup-clone bots are present', async () => {
    db.tournament.findMany.mockResolvedValue([
      { id: 'cup-stale-1', participants: [{ user: { id: 'user-mine', username: 'jpru' } }] },
    ])
    db.tournament.deleteMany.mockResolvedValue({ count: 1 })

    const r = await sweepOldCups()
    expect(r).toEqual({ tournaments: 1, bots: 0 })
    expect(db.user.deleteMany).not.toHaveBeenCalled()
  })

  it('runs cup deletion before bot deletion (FK ordering)', async () => {
    db.tournament.findMany.mockResolvedValue([
      {
        id: 'cup-z',
        participants: [{ user: { id: 'bot-cup-z-001', username: 'bot-cup-z-001' } }],
      },
    ])
    db.tournament.deleteMany.mockResolvedValue({ count: 1 })
    db.user.deleteMany.mockResolvedValue({ count: 1 })

    await sweepOldCups()
    const tournamentCall = db.tournament.deleteMany.mock.invocationCallOrder[0]
    const userCall       = db.user.deleteMany.mock.invocationCallOrder[0]
    expect(tournamentCall).toBeLessThan(userCall)
  })
})
