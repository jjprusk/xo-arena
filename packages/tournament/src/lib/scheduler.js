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
import { cancelTournament, startTournament } from '../services/tournamentService.js'

const INTERVAL_MS = 60 * 1000 // 1 minute

// Track which warnings have been sent to avoid duplicate notifications
// { tournamentId_minutes: true }
const sentWarnings = new Set()

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
  await Promise.allSettled([
    checkWarnings(),
    checkAutoCancel(),
    checkAutoStart(),
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
  } catch (err) {
    logger.error({ err }, 'Scheduler: checkWarnings failed')
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
