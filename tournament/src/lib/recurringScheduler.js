// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Recurring tournament occurrence generator.
 *
 * Phase 3.7a rewrite: reads from `tournament_templates` (pure config)
 * instead of `tournaments where isRecurring=true`. Each spawned
 * occurrence is a normal `Tournament` row with `templateId` pointing at
 * its parent template. Subscribers attach to the template; seed bots
 * attach to the template.
 *
 * Responsibilities:
 *   - For every un-paused `TournamentTemplate` whose next occurrence is
 *     due (or overdue), create a fresh Tournament row with cloned
 *     settings and templateId back-ref.
 *   - Auto-enroll standing human subscribers (RecurringTournamentRegistration
 *     with optedOutAt == null) into the new occurrence.
 *   - Auto-enroll the template's seed bots (TournamentTemplateSeedBot)
 *     into the new occurrence.
 *   - Publish `tournament:recurring:occurrence` for observers.
 *   - Skip templates whose `recurrenceEndDate` has passed.
 *
 * Called on a 60-second interval from index.js + the admin endpoint
 * `POST /api/tournaments/admin/scheduler/check-recurring`.
 */
import db from './db.js'
import { publish } from './redis.js'
import logger from '../logger.js'

/**
 * Compute the next recurrence start time strictly after `now`.
 * Works for both TournamentTemplate (recurrenceStart) and the legacy
 * Tournament shape (startTime) — the caller passes whichever object.
 */
function advanceOne(date, interval) {
  const d = new Date(date)
  switch (interval) {
    case 'DAILY':   return new Date(d.getTime() + 24 * 60 * 60 * 1000)
    case 'WEEKLY':  return new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000)
    case 'MONTHLY': return new Date(d.setMonth(d.getMonth() + 1))
    default:        return null
  }
}

function nextOccurrenceStart(template) {
  const start = template.recurrenceStart ?? template.startTime
  if (!start || !template.recurrenceInterval) return null
  const now = new Date()
  let next = new Date(start)
  while (next <= now) {
    const advanced = advanceOne(next, template.recurrenceInterval)
    if (!advanced) return null
    next = advanced
  }
  return next
}

// Count how many interval-steps were taken to advance `start` to `end`.
// Used to shift the template's registration-window datetimes by the
// same count, so the window stays anchored to the occurrence start.
function stepsBetween(start, end, interval) {
  if (!start || !end) return 0
  let n = 0
  let cursor = new Date(start)
  while (cursor < end && n < 10_000) {
    const advanced = advanceOne(cursor, interval)
    if (!advanced) break
    cursor = advanced
    n++
  }
  return n
}

function advanceBy(date, interval, steps) {
  if (!date || steps <= 0) return date ? new Date(date) : null
  let cursor = new Date(date)
  for (let i = 0; i < steps; i++) {
    const advanced = advanceOne(cursor, interval)
    if (!advanced) return null
    cursor = advanced
  }
  return cursor
}

/**
 * Run one pass. Returns a small summary that the admin endpoint can echo.
 * Always resolves (errors are caught per-template so a single bad row
 * doesn't stall the whole sweep).
 *
 * `includeTest` (default false) controls whether `isTest=true` templates
 * are processed. The 60s background sweep passes false so a leaked test
 * template can't drive load forever; the admin endpoint passes true so
 * QA can manually trigger occurrence creation for a specific test row.
 */
export async function checkRecurringOccurrences({ includeTest = false } = {}) {
  const summary = { templatesChecked: 0, occurrencesCreated: 0, errors: 0 }
  try {
    const templates = await db.tournamentTemplate.findMany({
      where: {
        paused: false,
        ...(includeTest ? {} : { isTest: false }),
      },
    })
    summary.templatesChecked = templates.length

    const now = new Date()
    for (const template of templates) {
      try {
        if (template.recurrenceEndDate && template.recurrenceEndDate < now) continue

        const nextStart = nextOccurrenceStart(template)
        if (!nextStart) continue
        if (template.recurrenceEndDate && nextStart > template.recurrenceEndDate) continue

        // Dedup: another pass may have already created this occurrence.
        // Templates + their first occurrences share an id (Phase 3.7a
        // migration), so a templateId+startTime pair is the unique key.
        const existing = await db.tournament.findFirst({
          where: { templateId: template.id, startTime: nextStart },
        })
        if (existing) continue

        // Registration window: shift the template's stored open/close
        // forward by the same number of interval-steps we advanced
        // recurrenceStart. Null stays null (fallback handled downstream:
        // open = now, close = startTime).
        const steps = stepsBetween(template.recurrenceStart, nextStart, template.recurrenceInterval)
        const occurrenceRegOpen  = advanceBy(template.registrationOpenAt,  template.recurrenceInterval, steps)
        const occurrenceRegClose = advanceBy(template.registrationCloseAt, template.recurrenceInterval, steps)

        // Gate: don't materialise the occurrence until its registration
        // window actually opens. Without this, a template with
        // `registrationOpenAt` hours in the future would still spawn now
        // and show up in the tournaments list prematurely.
        if (occurrenceRegOpen && now < occurrenceRegOpen) continue

        const occurrence = await db.tournament.create({
          data: {
            name: template.name,
            description: template.description,
            game: template.game,
            mode: template.mode,
            format: template.format,
            bracketType: template.bracketType,
            status: 'REGISTRATION_OPEN',
            minParticipants: template.minParticipants,
            maxParticipants: template.maxParticipants,
            bestOfN: template.bestOfN,
            botMinGamesPlayed: template.botMinGamesPlayed,
            allowNonCompetitiveBots: template.allowNonCompetitiveBots,
            startTime: nextStart,
            registrationOpenAt:  occurrenceRegOpen  ?? now,
            registrationCloseAt: occurrenceRegClose,    // null → sweep/route fall back to startTime
            templateId: template.id,                     // back-ref to template
            createdById: template.createdById,
            isTest: template.isTest ?? false,
          },
        })
        summary.occurrencesCreated++

        // Standing human subscriptions attached to the template.
        // NB: RecurringTournamentRegistration has no `user` relation in the
        // Prisma schema — fetch the isBot flags with a second query and map
        // them in. Previously this used `include: { user: ... }` and threw
        // on every spawn, silently skipping enrollment for every standing
        // subscriber (humans and seed bots both).
        const standing = await db.recurringTournamentRegistration.findMany({
          where: { templateId: template.id, optedOutAt: null },
        })
        const users = standing.length
          ? await db.user.findMany({
              where:  { id: { in: standing.map(r => r.userId) } },
              select: { id: true, isBot: true },
            })
          : []
        const isBotByUserId = Object.fromEntries(users.map(u => [u.id, u.isBot]))
        const autoEnrolledUserIds = []
        for (const reg of standing) {
          await db.tournamentParticipant.create({
            data: {
              tournamentId: occurrence.id,
              userId: reg.userId,
              eloAtRegistration: 1200,
              status: 'REGISTERED',
              registrationMode: 'RECURRING',
            },
          }).catch(() => { /* already registered — ignore */ })
          if (isBotByUserId[reg.userId] === false) autoEnrolledUserIds.push(reg.userId)
        }

        // Seed bots attached to the template.
        const seedBots = await db.tournamentTemplateSeedBot.findMany({
          where: { templateId: template.id },
        })
        for (const seed of seedBots) {
          await db.tournamentParticipant.upsert({
            where: { tournamentId_userId: { tournamentId: occurrence.id, userId: seed.userId } },
            create: { tournamentId: occurrence.id, userId: seed.userId, status: 'REGISTERED', registrationMode: 'SINGLE' },
            update: { status: 'REGISTERED' },
          }).catch(() => {})
          // Also stamp a per-occurrence TournamentSeedBot row so downstream
          // code that reads seed-bot membership from the occurrence (rather
          // than the template) still works during the cutover.
          await db.tournamentSeedBot.upsert({
            where: { tournamentId_userId: { tournamentId: occurrence.id, userId: seed.userId } },
            create: { tournamentId: occurrence.id, userId: seed.userId },
            update: {},
          }).catch(() => {})
        }

        await publish('tournament:recurring:occurrence', {
          templateId:           template.id,
          tournamentId:         occurrence.id,       // consistent name with other tournament:* events
          occurrenceId:         occurrence.id,       // legacy alias — retained for existing consumers
          name:                 template.name,
          startTime:            nextStart.toISOString(),
          autoEnrolledUserIds,                       // humans only; bridge targets them
        }).catch(() => {})

        logger.info({ templateId: template.id, occurrenceId: occurrence.id, nextStart }, 'Recurring occurrence created')
      } catch (err) {
        summary.errors++
        logger.error({ err, templateId: template.id }, 'Failed to generate occurrence')
      }
    }
  } catch (err) {
    logger.error({ err }, 'checkRecurringOccurrences failed')
  }
  return summary
}

// 1-minute sweep. Kept short because the query is a tiny findMany and the
// dedup guarantees no duplicate occurrences even if two ticks overlap.
const SWEEP_INTERVAL_MS = 60_000

export function startRecurringScheduler() {
  logger.info('Recurring occurrence scheduler started (60s interval)')
  checkRecurringOccurrences().catch(err => logger.error({ err }, 'Initial recurring check failed'))
  return setInterval(() => {
    checkRecurringOccurrences().catch(err => logger.error({ err }, 'Recurring check tick failed'))
  }, SWEEP_INTERVAL_MS)
}
