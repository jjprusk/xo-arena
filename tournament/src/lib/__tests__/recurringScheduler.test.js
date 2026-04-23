// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Unit tests for the recurring-tournament scheduler's Phase 3.7a cutover:
 * reads templates from `tournament_templates`, spawns occurrences with
 * templateId set, and dedupes on `(templateId, startTime)` so the 60s
 * sweep can't double-create. Seed bots come from the template's
 * `tournament_template_seed_bots` table.
 *
 * Time travel: the scheduler's `nextOccurrenceStart` advances one
 * interval at a time until strictly after `now`. Tests use fake timers
 * to pin `now` and predict the next-start deterministically.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockDb = {
  tournamentTemplate:       { findMany: vi.fn() },
  tournament:               { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  recurringTournamentRegistration: { findMany: vi.fn() },
  tournamentTemplateSeedBot:       { findMany: vi.fn() },
  tournamentParticipant:           { create: vi.fn(), upsert: vi.fn() },
  tournamentSeedBot:               { upsert: vi.fn() },
}
vi.mock('../db.js', () => ({ default: mockDb }))

const mockPublish = vi.fn().mockResolvedValue(undefined)
vi.mock('../redis.js', () => ({ publish: mockPublish }))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { checkRecurringOccurrences } = await import('../recurringScheduler.js')

// Fixed "now" anchor for tests: 2026-05-01T12:00:00Z.
const NOW = new Date('2026-05-01T12:00:00.000Z')

function makeTemplate(overrides = {}) {
  return {
    id:                      'tpl_daily',
    name:                    'Daily 3-Player',
    description:             null,
    game:                    'xo',
    mode:                    'MIXED',
    format:                  'SINGLE_ELIM',
    bracketType:             'SINGLE_ELIM',
    status:                  undefined,  // templates have no status
    minParticipants:         3,
    maxParticipants:         null,
    bestOfN:                 3,
    botMinGamesPlayed:       null,
    allowNonCompetitiveBots: false,
    allowSpectators:         true,
    noticePeriodMinutes:     null,
    durationMinutes:         null,
    paceMs:                  null,
    startMode:               'AUTO',
    recurrenceInterval:      'DAILY',
    recurrenceStart:         new Date('2026-04-01T19:00:00.000Z'), // past, so nextStart = today 19:00
    recurrenceEndDate:       null,
    paused:                  false,
    autoOptOutAfterMissed:   null,
    createdById:             'usr_admin',
    isTest:                  false,
    ...overrides,
  }
}

describe('checkRecurringOccurrences (Phase 3.7a)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    // Default: no subscribers, no seed bots.
    mockDb.recurringTournamentRegistration.findMany.mockResolvedValue([])
    mockDb.tournamentTemplateSeedBot.findMany.mockResolvedValue([])
    // These receive .catch() chains inside the scheduler, so they must
    // return promises (not undefined). Default to resolved no-ops.
    mockDb.tournamentParticipant.create.mockResolvedValue({})
    mockDb.tournamentParticipant.upsert.mockResolvedValue({})
    mockDb.tournamentSeedBot.upsert.mockResolvedValue({})
  })
  afterEach(() => { vi.useRealTimers() })

  it('reads from tournament_templates — never from Tournament where isRecurring', async () => {
    mockDb.tournamentTemplate.findMany.mockResolvedValue([])

    await checkRecurringOccurrences()

    expect(mockDb.tournamentTemplate.findMany).toHaveBeenCalledTimes(1)
    // Verify it filtered to un-paused templates
    const call = mockDb.tournamentTemplate.findMany.mock.calls[0][0]
    expect(call.where.paused).toBe(false)
  })

  it('spawns a Tournament with templateId set when no existing occurrence is found', async () => {
    const template = makeTemplate()
    mockDb.tournamentTemplate.findMany.mockResolvedValue([template])
    mockDb.tournament.findFirst.mockResolvedValue(null)  // no dedup hit
    mockDb.tournament.create.mockResolvedValue({ id: 'occ_1' })

    const summary = await checkRecurringOccurrences()

    expect(summary).toEqual({ templatesChecked: 1, occurrencesCreated: 1, errors: 0 })

    // Verify the Tournament create carried templateId + cloned config.
    const createArg = mockDb.tournament.create.mock.calls[0][0].data
    expect(createArg.templateId).toBe('tpl_daily')
    expect(createArg.isRecurring).toBe(false)           // occurrences never recur themselves
    expect(createArg.status).toBe('REGISTRATION_OPEN')
    expect(createArg.name).toBe('Daily 3-Player')
    // Next-start should be 2026-05-01T19:00 (today at 19:00Z — first future slot after NOW=12:00Z).
    expect(createArg.startTime.toISOString()).toBe('2026-05-01T19:00:00.000Z')
  })

  it('dedupes on (templateId, startTime) — does NOT double-create if the next occurrence already exists', async () => {
    const template = makeTemplate()
    mockDb.tournamentTemplate.findMany.mockResolvedValue([template])
    mockDb.tournament.findFirst.mockResolvedValue({ id: 'occ_existing' })  // already created

    const summary = await checkRecurringOccurrences()

    expect(summary.occurrencesCreated).toBe(0)
    expect(mockDb.tournament.create).not.toHaveBeenCalled()
    // And the dedup query used the new (templateId, startTime) key, not
    // the legacy (name, startTime, isRecurring) key.
    const findArg = mockDb.tournament.findFirst.mock.calls[0][0]
    expect(findArg.where.templateId).toBe('tpl_daily')
    expect(findArg.where.startTime).toBeInstanceOf(Date)
    expect(findArg.where.isRecurring).toBeUndefined()
  })

  it('skips templates past recurrenceEndDate', async () => {
    const past = makeTemplate({
      recurrenceEndDate: new Date('2026-04-30T00:00:00.000Z'),  // before NOW
    })
    mockDb.tournamentTemplate.findMany.mockResolvedValue([past])

    const summary = await checkRecurringOccurrences()

    expect(summary.occurrencesCreated).toBe(0)
    expect(mockDb.tournament.create).not.toHaveBeenCalled()
  })

  it('seeds template bots into the new occurrence via TournamentTemplateSeedBot', async () => {
    const template = makeTemplate()
    mockDb.tournamentTemplate.findMany.mockResolvedValue([template])
    mockDb.tournament.findFirst.mockResolvedValue(null)
    mockDb.tournament.create.mockResolvedValue({ id: 'occ_1' })
    mockDb.tournamentTemplateSeedBot.findMany.mockResolvedValue([
      { id: 'tsb_a', userId: 'bot_rusty' },
      { id: 'tsb_b', userId: 'bot_copper' },
    ])

    await checkRecurringOccurrences()

    // Participant upsert for each seed bot with registrationMode SINGLE.
    const upsertCalls = mockDb.tournamentParticipant.upsert.mock.calls.map(c => c[0])
    const rustyCall  = upsertCalls.find(c => c.where.tournamentId_userId.userId === 'bot_rusty')
    const copperCall = upsertCalls.find(c => c.where.tournamentId_userId.userId === 'bot_copper')
    expect(rustyCall).toBeDefined()
    expect(rustyCall.where.tournamentId_userId.tournamentId).toBe('occ_1')
    expect(rustyCall.create).toMatchObject({ registrationMode: 'SINGLE', status: 'REGISTERED' })
    expect(copperCall).toBeDefined()
    expect(copperCall.where.tournamentId_userId.tournamentId).toBe('occ_1')
    // Source query must be the template's seed-bot table, not the legacy one.
    expect(mockDb.tournamentTemplateSeedBot.findMany).toHaveBeenCalledWith({
      where: { templateId: 'tpl_daily' },
    })
  })

  it('publishes tournament:recurring:occurrence with human subscribers only', async () => {
    const template = makeTemplate()
    mockDb.tournamentTemplate.findMany.mockResolvedValue([template])
    mockDb.tournament.findFirst.mockResolvedValue(null)
    mockDb.tournament.create.mockResolvedValue({ id: 'occ_1' })
    mockDb.recurringTournamentRegistration.findMany.mockResolvedValue([
      { userId: 'usr_alice', user: { id: 'usr_alice', isBot: false } },
      { userId: 'bot_sneaky', user: { id: 'bot_sneaky', isBot: true  } },  // must be filtered out
    ])

    await checkRecurringOccurrences()

    expect(mockPublish).toHaveBeenCalledWith(
      'tournament:recurring:occurrence',
      expect.objectContaining({
        templateId:          'tpl_daily',
        tournamentId:        'occ_1',
        autoEnrolledUserIds: ['usr_alice'],  // bot excluded
      }),
    )
  })
})
