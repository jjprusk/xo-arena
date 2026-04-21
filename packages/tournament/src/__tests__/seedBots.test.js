/**
 * Seed-bot enrollment in recurring tournament occurrences.
 *
 * Verifies that when the scheduler creates a new occurrence of a recurring
 * tournament it copies seed-bot configs from the template and registers those
 * bots as participants in the new occurrence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── DB mock ───────────────────────────────────────────────────────────────────

const mockDb = {
  tournament: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
  recurringTournamentRegistration: { findMany: vi.fn() },
  tournamentParticipant: { create: vi.fn(), upsert: vi.fn() },
  tournamentSeedBot: { findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))
vi.mock('../lib/redis.js', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/tournamentService.js', () => ({
  cancelTournament: vi.fn(),
  startTournament: vi.fn(),
  forceResolveMatch: vi.fn(),
}))
vi.mock('../services/classificationService.js', () => ({
  runDemotionReview: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { checkRecurringOccurrences } = await import('../lib/scheduler.js')
const logger = (await import('../logger.js')).default

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTemplate(overrides = {}) {
  return {
    id: 'tmpl_1',
    name: 'Daily XO',
    description: null,
    game: 'xo',
    mode: 'BOT_VS_BOT',
    format: 'OPEN',
    bracketType: 'SINGLE_ELIM',
    status: 'COMPLETED',
    minParticipants: 2,
    maxParticipants: null,
    bestOfN: 1,
    botMinGamesPlayed: null,
    allowNonCompetitiveBots: false,
    allowSpectators: true,
    isRecurring: true,
    recurrenceInterval: 'DAILY',
    recurrenceEndDate: null,
    startTime: new Date(Date.now() - 25 * 60 * 60 * 1000), // yesterday
    registrationOpenAt: null,
    createdById: 'admin_1',
    startMode: 'AUTO',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no overdue tournaments, no flash tournaments
  mockDb.tournament.findMany.mockImplementation(({ where } = {}) => {
    if (where?.isRecurring) return Promise.resolve([])
    return Promise.resolve([])
  })
  mockDb.tournament.create.mockResolvedValue({ id: 'occ_1' })
  mockDb.tournament.findFirst.mockResolvedValue(null) // no existing occurrence
  mockDb.recurringTournamentRegistration.findMany.mockResolvedValue([])
  mockDb.tournamentSeedBot.findMany.mockResolvedValue([])
  mockDb.tournamentParticipant.upsert.mockResolvedValue({})
  mockDb.tournamentSeedBot.upsert.mockResolvedValue({})
  mockDb.tournamentParticipant.create.mockResolvedValue({})
})

describe('checkRecurringOccurrences — seed bot enrollment', () => {
  it('registers seed bots from the template into the new occurrence', async () => {
    const template = makeTemplate()

    mockDb.tournament.findMany.mockResolvedValue([template])
    mockDb.tournamentSeedBot.findMany.mockResolvedValue([
      { tournamentId: 'tmpl_1', userId: 'bot_1' },
      { tournamentId: 'tmpl_1', userId: 'bot_2' },
    ])

    await checkRecurringOccurrences()

    // Occurrence was created
    expect(mockDb.tournament.create).toHaveBeenCalledOnce()

    // Seed bots were looked up
    expect(mockDb.tournamentSeedBot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tournamentId: 'tmpl_1' } })
    )

    // Both bots upserted as participants
    const participantCalls = mockDb.tournamentParticipant.upsert.mock.calls
    const enrolledUserIds = participantCalls.map(c => c[0].create.userId)
    expect(enrolledUserIds).toContain('bot_1')
    expect(enrolledUserIds).toContain('bot_2')

    // Seed bot config rows created on the new occurrence
    const seedCalls = mockDb.tournamentSeedBot.upsert.mock.calls
    const seedUserIds = seedCalls.map(c => c[0].create.userId)
    expect(seedUserIds).toContain('bot_1')
    expect(seedUserIds).toContain('bot_2')
  })

  it('skips seed bot enrollment gracefully when upsert fails', async () => {
    const template = makeTemplate()

    mockDb.tournament.findMany.mockResolvedValue([template])
    mockDb.tournamentSeedBot.findMany.mockResolvedValue([
      { tournamentId: 'tmpl_1', userId: 'bot_err' },
    ])
    mockDb.tournamentParticipant.upsert.mockRejectedValue(new Error('DB error'))

    // Should not throw
    await expect(checkRecurringOccurrences()).resolves.not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ seedBotUserId: 'bot_err' }),
      expect.any(String)
    )
  })

  it('does nothing when template has no seed bots', async () => {
    const template = makeTemplate()

    mockDb.tournament.findMany.mockResolvedValue([template])
    mockDb.tournamentSeedBot.findMany.mockResolvedValue([])

    await checkRecurringOccurrences()

    expect(mockDb.tournamentParticipant.upsert).not.toHaveBeenCalled()
    expect(mockDb.tournamentSeedBot.upsert).not.toHaveBeenCalled()
  })
})
