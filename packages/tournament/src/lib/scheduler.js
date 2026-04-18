/**
 * Background scheduler for tournament automation.
 *
 * Jobs (run every minute):
 * - Warning notifications: tournaments starting in ~60 min or ~15 min
 * - Auto-cancel: REGISTRATION_OPEN tournaments past registrationCloseAt with unmet minParticipants
 * - Auto-start: REGISTRATION_OPEN tournaments past startTime
 */

import db from '@xo-arena/db'
import logger from '../logger.js'
import { publishEvent } from './redis.js'
import { cancelTournament, startTournament, forceResolveMatch } from '../services/tournamentService.js'
import { runDemotionReview } from '../services/classificationService.js'

const INTERVAL_MS = 60 * 1000 // 1 minute

// Track which warnings have been sent to avoid duplicate notifications
// { tournamentId_minutes: true }
const sentWarnings = new Set()

let lastDemotionReviewDate = null
let lastOccurrenceCheckDate = null
let lastRetentionCheckDate = null

/**
 * Start background scheduler.
 */
export function startScheduler() {
  logger.info('Tournament scheduler started')

  const interval = setInterval(async () => {
    await runSchedulerTick()
  }, INTERVAL_MS)

  // Run immediately on startup
  runSchedulerTick().catch(err => {
    logger.error({ err }, 'Initial scheduler tick failed')
  })

  return interval
}

/**
 * Execute one scheduler tick. Separated for testability.
 */
export async function runSchedulerTick() {
  // Daily demotion review
  const today = new Date().toISOString().slice(0, 10)
  if (lastDemotionReviewDate !== today) {
    lastDemotionReviewDate = today
    runDemotionReview().catch(err => logger.error({ err }, 'Demotion review failed'))
  }

  // Daily recurring occurrence check
  const todayDate = new Date().toISOString().slice(0, 10)
  if (lastOccurrenceCheckDate !== todayDate) {
    lastOccurrenceCheckDate = todayDate
    checkRecurringOccurrences().catch(err =>
      logger.error({ err }, 'Recurring occurrence check failed')
    )
  }

  // Daily replay retention cleanup
  const retentionDate = new Date().toISOString().slice(0, 10)
  if (lastRetentionCheckDate !== retentionDate) {
    lastRetentionCheckDate = retentionDate
    runReplayRetention().catch(err => logger.error({ err }, 'Replay retention failed'))
  }

  await Promise.allSettled([
    checkWarnings(),
    checkAutoCancel(),
    checkAutoStart(),
    checkFlashClose(),
  ])
}

// ─── Warning notifications ────────────────────────────────────────────────────

async function checkWarnings() {
  try {
    const now = new Date()

    for (const minutesUntilStart of [60, 15]) {
      // Find tournaments starting in [minutesUntilStart - 1, minutesUntilStart + 1] minutes
      const windowStart = new Date(now.getTime() + (minutesUntilStart - 1) * 60 * 1000)
      const windowEnd = new Date(now.getTime() + (minutesUntilStart + 1) * 60 * 1000)

      const tournaments = await db.tournament.findMany({
        where: {
          status: 'REGISTRATION_OPEN',
          startTime: {
            gte: windowStart,
            lte: windowEnd,
          },
        },
        include: {
          participants: {
            where: { status: { notIn: ['WITHDRAWN'] } },
            include: { user: { select: { betterAuthId: true } } },
          },
        },
      })

      for (const tournament of tournaments) {
        const warningKey = `${tournament.id}_${minutesUntilStart}`
        if (sentWarnings.has(warningKey)) continue

        const participantUserIds = tournament.participants
          .map(p => p.user?.betterAuthId)
          .filter(Boolean)

        await publishEvent('tournament:warning', {
          tournamentId: tournament.id,
          minutesUntilStart,
          participantUserIds,
        })

        sentWarnings.add(warningKey)
        logger.info(
          { tournamentId: tournament.id, minutesUntilStart },
          'Tournament warning published'
        )
      }
    }

    // 2-min warning — FLASH tournaments only, filtered to opted-in participants
    await checkFlashTwoMinWarning()
  } catch (err) {
    logger.error({ err }, 'Scheduler: checkWarnings failed')
  }
}

export async function checkFlashTwoMinWarning(now = new Date()) {
  const windowStart = new Date(now.getTime() + 1 * 60 * 1000)
  const windowEnd   = new Date(now.getTime() + 3 * 60 * 1000)

  const tournaments = await db.tournament.findMany({
    where: {
      format: 'FLASH',
      status: 'REGISTRATION_OPEN',
      startTime: { gte: windowStart, lte: windowEnd },
    },
    include: {
      participants: {
        where: { status: { notIn: ['WITHDRAWN'] } },
        include: { user: { select: { betterAuthId: true, preferences: true } } },
      },
    },
  })

  for (const tournament of tournaments) {
    const warningKey = `${tournament.id}_2`
    if (sentWarnings.has(warningKey)) continue

    // Filter to participants who have not explicitly disabled flash start alerts
    const participantUserIds = tournament.participants
      .filter(p => p.user?.preferences?.flashStartAlerts !== false)
      .map(p => p.user?.betterAuthId)
      .filter(Boolean)

    if (participantUserIds.length === 0) {
      sentWarnings.add(warningKey)
      continue
    }

    await publishEvent('tournament:warning', {
      tournamentId: tournament.id,
      minutesUntilStart: 2,
      participantUserIds,
    })

    sentWarnings.add(warningKey)
    logger.info(
      { tournamentId: tournament.id, count: participantUserIds.length },
      'Flash 2-min warning published'
    )
  }
}

// ─── Auto-cancel ──────────────────────────────────────────────────────────────

async function checkAutoCancel() {
  try {
    const now = new Date()

    // Find REGISTRATION_OPEN tournaments past registrationCloseAt
    const tournaments = await db.tournament.findMany({
      where: {
        status: 'REGISTRATION_OPEN',
        registrationCloseAt: { lt: now },
      },
      include: {
        _count: {
          select: { participants: { where: { status: { notIn: ['WITHDRAWN'] } } } },
        },
      },
    })

    for (const tournament of tournaments) {
      const participantCount = tournament._count.participants
      if (participantCount < tournament.minParticipants) {
        logger.info(
          {
            tournamentId: tournament.id,
            participantCount,
            minParticipants: tournament.minParticipants,
          },
          'Scheduler: auto-cancelling tournament (insufficient participants after close)'
        )
        try {
          await cancelTournament(tournament.id, 'system')
        } catch (err) {
          logger.error({ err, tournamentId: tournament.id }, 'Scheduler: auto-cancel failed')
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler: checkAutoCancel failed')
  }
}

// ─── Auto-start ───────────────────────────────────────────────────────────────

async function checkAutoStart() {
  try {
    const now = new Date()

    // Find REGISTRATION_OPEN tournaments past their startTime
    const tournaments = await db.tournament.findMany({
      where: {
        status: 'REGISTRATION_OPEN',
        startTime: { lt: now },
      },
    })

    for (const tournament of tournaments) {
      logger.info(
        { tournamentId: tournament.id },
        'Scheduler: auto-starting tournament'
      )
      try {
        await startTournament(tournament.id, 'system')
      } catch (err) {
        // startTournament may auto-cancel if minParticipants not met — that's expected
        logger.warn({ err: err.message, tournamentId: tournament.id }, 'Scheduler: auto-start result')
      }
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler: checkAutoStart failed')
  }
}

// ─── Flash auto-close ─────────────────────────────────────────────────────────

async function checkFlashClose() {
  try {
    const now = new Date()

    // Find IN_PROGRESS FLASH tournaments whose endTime has passed
    const tournaments = await db.tournament.findMany({
      where: {
        format: 'FLASH',
        status: 'IN_PROGRESS',
        endTime: { lt: now },
      },
    })

    for (const tournament of tournaments) {
      logger.info({ tournamentId: tournament.id }, 'Scheduler: force-closing flash tournament')
      try {
        // Force-resolve all incomplete matches
        const incompleteMatches = await db.tournamentMatch.findMany({
          where: {
            tournamentId: tournament.id,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
        })

        for (const match of incompleteMatches) {
          if (match.participant1Id && match.participant2Id) {
            await forceResolveMatch(match.id)
          }
        }
      } catch (err) {
        logger.error({ err, tournamentId: tournament.id }, 'Scheduler: flash close failed')
      }
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler: checkFlashClose failed')
  }
}

// ─── Recurring tournament occurrence generation ────────────────────────────────

export async function checkRecurringOccurrences() {
  try {
    // Find recurring template tournaments that have COMPLETED and need a new occurrence
    const templates = await db.tournament.findMany({
      where: {
        isRecurring: true,
        status: 'COMPLETED',
        recurrenceInterval: { not: null },
      },
    })

    const now = new Date()

    for (const template of templates) {
      try {
        // Check if recurrenceEndDate has passed
        if (template.recurrenceEndDate && template.recurrenceEndDate < now) continue

        // Determine next occurrence start time
        const nextStart = _nextOccurrenceStart(template)
        if (!nextStart || nextStart > (template.recurrenceEndDate ?? new Date('2100-01-01'))) continue

        // Check if an occurrence for this window already exists
        const existing = await db.tournament.findFirst({
          where: {
            name: template.name,
            startTime: nextStart,
            isRecurring: false, // occurrences are not templates themselves
          },
        })
        if (existing) continue

        // Create new occurrence (clone of template)
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
            isRecurring: false,
            createdById: template.createdById,
          },
        })

        logger.info(
          { templateId: template.id, occurrenceId: occurrence.id, nextStart },
          'Recurring occurrence created'
        )

        // Auto-enroll RECURRING participants from the template
        const standingRegistrations = await db.recurringTournamentRegistration.findMany({
          where: { templateId: template.id, optedOutAt: null },
        })

        for (const reg of standingRegistrations) {
          try {
            await db.tournamentParticipant.create({
              data: {
                tournamentId: occurrence.id,
                userId: reg.userId,
                eloAtRegistration: 1200, // will be overwritten at start
                status: 'REGISTERED',
                registrationMode: 'RECURRING',
              },
            })
          } catch {
            // May already be registered; skip
          }
        }

        // Auto-enroll seed bots from the template into the new occurrence
        const seedBots = await db.tournamentSeedBot.findMany({
          where: { tournamentId: template.id },
        })
        for (const seed of seedBots) {
          try {
            await db.tournamentParticipant.upsert({
              where: { tournamentId_userId: { tournamentId: occurrence.id, userId: seed.userId } },
              create: { tournamentId: occurrence.id, userId: seed.userId, status: 'REGISTERED', registrationMode: 'SINGLE' },
              update: { status: 'REGISTERED' },
            })
            await db.tournamentSeedBot.upsert({
              where: { tournamentId_userId: { tournamentId: occurrence.id, userId: seed.userId } },
              create: { tournamentId: occurrence.id, userId: seed.userId },
              update: {},
            })
          } catch (err) {
            logger.warn({ err, seedBotUserId: seed.userId }, 'Failed to enroll seed bot in recurring occurrence')
          }
        }

        // Publish notification for new occurrence
        await publishEvent('tournament:recurring:occurrence', {
          templateId: template.id,
          occurrenceId: occurrence.id,
          startTime: nextStart,
        })
      } catch (err) {
        logger.error({ err, templateId: template.id }, 'Failed to generate occurrence')
      }
    }
  } catch (err) {
    logger.error({ err }, 'checkRecurringOccurrences failed')
  }
}

// ─── Replay retention ─────────────────────────────────────────────────────────

async function _getSystemConfig(key, defaultValue) {
  try {
    const row = await db.systemConfig.findUnique({ where: { key } })
    return row?.value ?? defaultValue
  } catch {
    return defaultValue
  }
}

export async function runReplayRetention() {
  const defaultDays = await _getSystemConfig('tournament.replay.defaultRetentionDays', 30)

  const tournaments = await db.tournament.findMany({
    where: { status: 'COMPLETED' },
    select: { id: true, replayRetentionDays: true, updatedAt: true },
  })

  for (const t of tournaments) {
    const retentionDays = t.replayRetentionDays ?? defaultDays
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    if (t.updatedAt > cutoff) continue // Not expired yet

    const deleted = await db.game.deleteMany({
      where: { tournamentId: t.id },
    })

    if (deleted.count > 0) {
      logger.info(
        { tournamentId: t.id, deleted: deleted.count },
        'Replay retention: games deleted'
      )
    }
  }
}

function _nextOccurrenceStart(template) {
  if (!template.startTime || !template.recurrenceInterval) return null

  const base = new Date(template.startTime)
  const now = new Date()

  // Find the next occurrence after now
  let next = new Date(base)
  while (next <= now) {
    switch (template.recurrenceInterval) {
      case 'DAILY':
        next = new Date(next.getTime() + 24 * 60 * 60 * 1000)
        break
      case 'WEEKLY':
        next = new Date(next.getTime() + 7 * 24 * 60 * 60 * 1000)
        break
      case 'MONTHLY':
        next = new Date(next.setMonth(next.getMonth() + 1))
        break
      case 'CUSTOM':
        return null // Custom interval requires manual handling
      default:
        return null
    }
  }
  return next
}
