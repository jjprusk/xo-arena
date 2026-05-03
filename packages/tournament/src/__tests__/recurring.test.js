/**
 * Phase 4: Recurring tournament tests
 *
 * Covers:
 * - createStandingRegistration: success and duplicate rejection
 * - cancelStandingRegistration: success, not found
 * - processOccurrenceCompletion: increment missedCount, auto-opt-out, reset on participation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = {
  user: { findUnique: vi.fn() },
  tournament: { findUnique: vi.fn() },
  recurringTournamentRegistration: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  },
  tournamentParticipant: { findUnique: vi.fn() },
}

vi.mock('@xo-arena/db', () => ({ default: mockDb }))

const {
  createStandingRegistration,
  cancelStandingRegistration,
  processOccurrenceCompletion,
} = await import('../services/recurringService.js')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createStandingRegistration', () => {
  it('creates a new standing registration', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.tournament.findUnique.mockResolvedValue({ id: 'tmpl_1', isRecurring: true })
    mockDb.recurringTournamentRegistration.findUnique.mockResolvedValue(null)
    mockDb.recurringTournamentRegistration.create.mockResolvedValue({
      id: 'reg_1', templateId: 'tmpl_1', userId: 'user_1', missedCount: 0,
    })

    const result = await createStandingRegistration('tmpl_1', 'ba_1')
    expect(result.templateId).toBe('tmpl_1')
    expect(mockDb.recurringTournamentRegistration.create).toHaveBeenCalled()
  })

  it('throws 409 if already registered', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.tournament.findUnique.mockResolvedValue({ id: 'tmpl_1', isRecurring: true })
    mockDb.recurringTournamentRegistration.findUnique.mockResolvedValue({
      id: 'reg_1', optedOutAt: null,
    })

    await expect(createStandingRegistration('tmpl_1', 'ba_1')).rejects.toMatchObject({ status: 409 })
  })

  it('throws 409 if tournament is not a recurring template', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.tournament.findUnique.mockResolvedValue({ id: 'tmpl_1', isRecurring: false })

    await expect(createStandingRegistration('tmpl_1', 'ba_1')).rejects.toMatchObject({ status: 409 })
  })
})

describe('cancelStandingRegistration', () => {
  it('sets optedOutAt on existing active registration', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.recurringTournamentRegistration.findUnique.mockResolvedValue({
      id: 'reg_1', optedOutAt: null,
    })
    mockDb.recurringTournamentRegistration.update.mockResolvedValue({
      id: 'reg_1', optedOutAt: new Date(),
    })

    const result = await cancelStandingRegistration('tmpl_1', 'ba_1')
    expect(result.optedOutAt).toBeDefined()
  })

  it('throws 404 if no active registration found', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'user_1' })
    mockDb.recurringTournamentRegistration.findUnique.mockResolvedValue(null)

    await expect(cancelStandingRegistration('tmpl_1', 'ba_1')).rejects.toMatchObject({ status: 404 })
  })
})

describe('processOccurrenceCompletion', () => {
  it('increments missedCount when participant did not participate', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ id: 'tmpl_1', autoOptOutAfterMissed: 3 })
    mockDb.recurringTournamentRegistration.findMany.mockResolvedValue([
      { id: 'reg_1', userId: 'user_1', missedCount: 0, optedOutAt: null },
    ])
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null) // did not participate
    mockDb.recurringTournamentRegistration.update.mockResolvedValue({})

    await processOccurrenceCompletion('occ_1', 'tmpl_1')

    expect(mockDb.recurringTournamentRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { missedCount: 1 } })
    )
  })

  it('auto-opts-out when missed count reaches threshold', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ id: 'tmpl_1', autoOptOutAfterMissed: 3 })
    mockDb.recurringTournamentRegistration.findMany.mockResolvedValue([
      { id: 'reg_1', userId: 'user_1', missedCount: 2, optedOutAt: null },
    ])
    mockDb.tournamentParticipant.findUnique.mockResolvedValue(null) // missed again
    mockDb.recurringTournamentRegistration.update.mockResolvedValue({})

    await processOccurrenceCompletion('occ_1', 'tmpl_1')

    const updateCall = mockDb.recurringTournamentRegistration.update.mock.calls[0]
    expect(updateCall[0].data.missedCount).toBe(3)
    expect(updateCall[0].data.optedOutAt).toBeDefined()
  })

  it('resets missedCount when participant participated', async () => {
    mockDb.tournament.findUnique.mockResolvedValue({ id: 'tmpl_1', autoOptOutAfterMissed: 3 })
    mockDb.recurringTournamentRegistration.findMany.mockResolvedValue([
      { id: 'reg_1', userId: 'user_1', missedCount: 2, optedOutAt: null },
    ])
    mockDb.tournamentParticipant.findUnique.mockResolvedValue({
      id: 'part_1', status: 'ELIMINATED',
    })
    mockDb.recurringTournamentRegistration.update.mockResolvedValue({})

    await processOccurrenceCompletion('occ_1', 'tmpl_1')

    expect(mockDb.recurringTournamentRegistration.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { missedCount: 0 } })
    )
  })
})
