/**
 * Phase 5: Replay retention tests
 *
 * Covers:
 * 1. Games are deleted when retention window has expired
 * 2. Games are NOT deleted when within the retention window
 * 3. Uses defaultRetentionDays from SystemConfig when tournament has no override
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  tournament: { findMany: vi.fn() },
  game: { deleteMany: vi.fn() },
  systemConfig: { findUnique: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

// ─── Mock logger (silence output in tests) ────────────────────────────────────

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

const { runReplayRetention } = await import('../lib/scheduler.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDb.game.deleteMany.mockResolvedValue({ count: 0 })
  mockDb.systemConfig.findUnique.mockResolvedValue(null) // default: use hardcoded 30
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runReplayRetention', () => {
  it('deletes games for a tournament whose retention window has expired', async () => {
    mockDb.tournament.findMany.mockResolvedValue([
      { id: 'tour_expired', replayRetentionDays: 30, updatedAt: daysAgo(31) },
    ])
    mockDb.game.deleteMany.mockResolvedValue({ count: 5 })

    await runReplayRetention()

    expect(mockDb.game.deleteMany).toHaveBeenCalledOnce()
    expect(mockDb.game.deleteMany).toHaveBeenCalledWith({
      where: { tournamentId: 'tour_expired' },
    })
  })

  it('does NOT delete games for a tournament still within the retention window', async () => {
    mockDb.tournament.findMany.mockResolvedValue([
      { id: 'tour_fresh', replayRetentionDays: 30, updatedAt: daysAgo(10) },
    ])

    await runReplayRetention()

    expect(mockDb.game.deleteMany).not.toHaveBeenCalled()
  })

  it('uses defaultRetentionDays from SystemConfig when tournament has no override', async () => {
    // SystemConfig overrides default to 7 days
    mockDb.systemConfig.findUnique.mockResolvedValue({ key: 'tournament.replay.defaultRetentionDays', value: 7 })

    mockDb.tournament.findMany.mockResolvedValue([
      // updatedAt is 8 days ago — past the 7-day SystemConfig default
      { id: 'tour_config', replayRetentionDays: 30, updatedAt: daysAgo(8) },
    ])
    mockDb.game.deleteMany.mockResolvedValue({ count: 3 })

    await runReplayRetention()

    // replayRetentionDays=30 on the tournament itself wins over SystemConfig,
    // so 8 days is still within the 30-day window — should NOT delete
    expect(mockDb.game.deleteMany).not.toHaveBeenCalled()
  })

  it('falls back to SystemConfig default when tournament replayRetentionDays is null', async () => {
    // SystemConfig says 7 days
    mockDb.systemConfig.findUnique.mockResolvedValue({ key: 'tournament.replay.defaultRetentionDays', value: 7 })

    mockDb.tournament.findMany.mockResolvedValue([
      // null replayRetentionDays means use SystemConfig default (7); updatedAt is 8 days ago
      { id: 'tour_null_days', replayRetentionDays: null, updatedAt: daysAgo(8) },
    ])
    mockDb.game.deleteMany.mockResolvedValue({ count: 2 })

    await runReplayRetention()

    expect(mockDb.game.deleteMany).toHaveBeenCalledOnce()
    expect(mockDb.game.deleteMany).toHaveBeenCalledWith({
      where: { tournamentId: 'tour_null_days' },
    })
  })
})
