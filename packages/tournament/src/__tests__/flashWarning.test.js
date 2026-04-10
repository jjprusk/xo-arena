/**
 * Phase 4: Flash 2-min warning tests
 *
 * Covers checkFlashTwoMinWarning:
 * - Publishes tournament:warning with minutesUntilStart=2 for FLASH tournaments in window
 * - Filters out participants with flashStartAlerts=false
 * - Skips publishing if no opted-in participants remain
 * - Does not re-publish for the same tournament (dedup via sentWarnings)
 * - Does not match PLANNED format tournaments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock @xo-arena/db ────────────────────────────────────────────────────────

const mockDb = {
  tournament: { findMany: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

// ─── Mock Redis publisher ─────────────────────────────────────────────────────

const mockPublishEvent = vi.fn().mockResolvedValue(undefined)
vi.mock('../lib/redis.js', () => ({ publishEvent: mockPublishEvent }))

// ─── Mock logger ─────────────────────────────────────────────────────────────

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// ─── Mock dependencies pulled in by tournamentService ────────────────────────
vi.mock('../services/tournamentService.js', () => ({
  cancelTournament: vi.fn(),
  startTournament: vi.fn(),
  forceResolveMatch: vi.fn(),
}))
vi.mock('../services/classificationService.js', () => ({
  runDemotionReview: vi.fn(),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

const { checkFlashTwoMinWarning } = await import('../lib/scheduler.js')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minutesFromNow(n) {
  return new Date(Date.now() + n * 60 * 1000)
}

function makeFlashTournament(overrides = {}) {
  return {
    id: 'tour_flash',
    format: 'FLASH',
    status: 'REGISTRATION_OPEN',
    startTime: minutesFromNow(2),
    participants: [
      { user: { betterAuthId: 'ba_1', preferences: {} } },
      { user: { betterAuthId: 'ba_2', preferences: { flashStartAlerts: true } } },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockPublishEvent.mockResolvedValue(undefined)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('checkFlashTwoMinWarning', () => {
  it('publishes tournament:warning with minutesUntilStart=2 for opted-in participants', async () => {
    mockDb.tournament.findMany.mockResolvedValue([makeFlashTournament()])

    await checkFlashTwoMinWarning()

    expect(mockPublishEvent).toHaveBeenCalledWith('tournament:warning', {
      tournamentId: 'tour_flash',
      minutesUntilStart: 2,
      participantUserIds: ['ba_1', 'ba_2'],
    })
  })

  it('excludes participants with flashStartAlerts=false', async () => {
    mockDb.tournament.findMany.mockResolvedValue([
      makeFlashTournament({
        id: 'tour_filter',
        participants: [
          { user: { betterAuthId: 'ba_1', preferences: { flashStartAlerts: false } } },
          { user: { betterAuthId: 'ba_2', preferences: {} } },
        ],
      }),
    ])

    await checkFlashTwoMinWarning()

    expect(mockPublishEvent).toHaveBeenCalledOnce()
    const [, payload] = mockPublishEvent.mock.calls[0]
    expect(payload.participantUserIds).toEqual(['ba_2'])
    expect(payload.participantUserIds).not.toContain('ba_1')
  })

  it('does not publish if all participants have opted out', async () => {
    mockDb.tournament.findMany.mockResolvedValue([
      makeFlashTournament({
        id: 'tour_all_out',
        participants: [
          { user: { betterAuthId: 'ba_1', preferences: { flashStartAlerts: false } } },
        ],
      }),
    ])

    await checkFlashTwoMinWarning()

    expect(mockPublishEvent).not.toHaveBeenCalled()
  })

  it('does not publish for PLANNED format tournaments', async () => {
    // The db query filters by format=FLASH, so PLANNED tournaments won't appear.
    // Verify the query includes the format filter.
    mockDb.tournament.findMany.mockResolvedValue([])

    await checkFlashTwoMinWarning()

    expect(mockPublishEvent).not.toHaveBeenCalled()
    const queryWhere = mockDb.tournament.findMany.mock.calls[0][0].where
    expect(queryWhere.format).toBe('FLASH')
  })

  it('does not re-publish for the same tournament (dedup)', async () => {
    // Use a unique ID so sentWarnings hasn't seen it
    mockDb.tournament.findMany.mockResolvedValue([makeFlashTournament({ id: 'tour_dedup_unique' })])

    await checkFlashTwoMinWarning()
    await checkFlashTwoMinWarning()

    // Only one publish despite two calls
    expect(mockPublishEvent).toHaveBeenCalledTimes(1)
  })
})
