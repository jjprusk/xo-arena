// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Recurring tournament occurrence generator.
 *
 * Ported from `packages/tournament/src/lib/scheduler.js` into the live
 * tournament service because the package-workspace scheduler was never
 * imported by `tournament/src/index.js` and therefore never ran in
 * production. Keep this file in sync with the package version if the two
 * tournament codepaths are ever reconciled.
 *
 * Responsibilities:
 *   - For every `isRecurring: true` template that has finished an
 *     occurrence, compute the next occurrence's start time from the
 *     interval and create a fresh tournament row with cloned settings.
 *   - Auto-enroll standing human subscribers (RecurringTournamentRegistration
 *     with optedOutAt == null) into the new occurrence.
 *   - Auto-enroll the template's seed bots into the new occurrence.
 *   - Publish `tournament:recurring:occurrence` for observers.
 *   - Skip templates whose `recurrenceEndDate` has passed or which are
 *     `recurrencePaused`.
 *
 * Called both on a 60-second interval (see index.js) and from the admin
 * endpoint `POST /api/tournaments/admin/scheduler/check-recurring`.
 */
import db from './db.js'
import { publish } from './redis.js'
import logger from '../logger.js'

/** Compute the next recurrence start time strictly after `now`. */
function nextOccurrenceStart(template) {
  if (!template.startTime || !template.recurrenceInterval) return null
  const now = new Date()
  let next = new Date(template.startTime)
  // Advance until strictly in the future. One step per iteration — DAILY
  // never overshoots, MONTHLY handles day-of-month roll-over via Date.setMonth.
  while (next <= now) {
    switch (template.recurrenceInterval) {
      case 'DAILY':   next = new Date(next.getTime() + 24 * 60 * 60 * 1000); break
      case 'WEEKLY':  next = new Date(next.getTime() + 7 * 24 * 60 * 60 * 1000); break
      case 'MONTHLY': next = new Date(next.setMonth(next.getMonth() + 1)); break
      default: return null  // unsupported interval (CUSTOM removed from the form)
    }
  }
  return next
}

/**
 * Run one pass. Returns a small summary that the admin endpoint can echo.
 * Always resolves (errors are caught per-template so a single bad row
 * doesn't stall the whole sweep).
 */
export async function checkRecurringOccurrences() {
  const summary = { templatesChecked: 0, occurrencesCreated: 0, errors: 0 }
  try {
    const templates = await db.tournament.findMany({
      where: {
        isRecurring: true,
        status: 'COMPLETED',
        recurrenceInterval: { not: null },
        recurrencePaused: false,
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
        const existing = await db.tournament.findFirst({
          where: { name: template.name, startTime: nextStart, isRecurring: false },
        })
        if (existing) continue

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
            registrationOpenAt: now,
            isRecurring: false,                         // occurrences never themselves recur
            createdById: template.createdById,
            isTest: template.isTest ?? false,
          },
        })
        summary.occurrencesCreated++

        // Standing human subscriptions. Collect the human userIds so the
        // backend bridge can send a per-subscriber "you're entered in today's
        // occurrence" notification — RecurringTournamentRegistration.userId
        // already points at humans (bots don't subscribe themselves), but
        // filter defensively in case an admin ever seeds a bot subscription.
        const standing = await db.recurringTournamentRegistration.findMany({
          where: { templateId: template.id, optedOutAt: null },
          include: { user: { select: { id: true, isBot: true } } },
        })
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
          if (reg.user && !reg.user.isBot) autoEnrolledUserIds.push(reg.userId)
        }

        // Seed bots defined on the template.
        const seedBots = await db.tournamentSeedBot.findMany({
          where: { tournamentId: template.id },
        })
        for (const seed of seedBots) {
          await db.tournamentParticipant.upsert({
            where: { tournamentId_userId: { tournamentId: occurrence.id, userId: seed.userId } },
            create: { tournamentId: occurrence.id, userId: seed.userId, status: 'REGISTERED', registrationMode: 'SINGLE' },
            update: { status: 'REGISTERED' },
          }).catch(() => {})
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
