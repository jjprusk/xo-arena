/**
 * Recurring tournament registration service.
 *
 * Manages standing registrations (RECURRING mode) for template tournaments.
 * A "template" tournament has isRecurring=true; each occurrence is a separate
 * Tournament record created by the scheduler.
 */

import db from '@xo-arena/db'
import logger from '../logger.js'

/**
 * Register a user for all future occurrences of a recurring tournament.
 * Creates a RecurringTournamentRegistration standing entry.
 */
export async function createStandingRegistration(templateId, betterAuthId) {
  const user = await db.user.findUnique({
    where: { betterAuthId },
    select: { id: true },
  })
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 })

  const template = await db.tournament.findUnique({ where: { id: templateId } })
  if (!template) throw Object.assign(new Error('Tournament not found'), { status: 404 })
  if (!template.isRecurring) {
    throw Object.assign(new Error('Tournament is not a recurring template'), { status: 409 })
  }

  const existing = await db.recurringTournamentRegistration.findUnique({
    where: { templateId_userId: { templateId, userId: user.id } },
  })

  if (existing) {
    if (!existing.optedOutAt) {
      throw Object.assign(new Error('Already registered for recurring occurrences'), { status: 409 })
    }
    // Re-activate
    return db.recurringTournamentRegistration.update({
      where: { id: existing.id },
      data: { optedOutAt: null, missedCount: 0 },
    })
  }

  const reg = await db.recurringTournamentRegistration.create({
    data: { templateId, userId: user.id },
  })

  logger.info({ templateId, userId: user.id }, 'Standing registration created')
  return reg
}

/**
 * Opt out of all future occurrences.
 */
export async function cancelStandingRegistration(templateId, betterAuthId) {
  const user = await db.user.findUnique({
    where: { betterAuthId },
    select: { id: true },
  })
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 })

  const reg = await db.recurringTournamentRegistration.findUnique({
    where: { templateId_userId: { templateId, userId: user.id } },
  })
  if (!reg || reg.optedOutAt) {
    throw Object.assign(new Error('No active standing registration found'), { status: 404 })
  }

  const updated = await db.recurringTournamentRegistration.update({
    where: { id: reg.id },
    data: { optedOutAt: new Date() },
  })

  logger.info({ templateId, userId: user.id }, 'Standing registration cancelled')
  return updated
}

/**
 * List all standing registrations for a template.
 */
export async function listStandingRegistrations(templateId) {
  return db.recurringTournamentRegistration.findMany({
    where: { templateId, optedOutAt: null },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * After an occurrence completes, increment missedCount for participants who
 * were auto-enrolled (RECURRING mode) but did not actually participate.
 * Auto-opt-out those who exceeded the template's autoOptOutAfterMissed limit.
 */
export async function processOccurrenceCompletion(occurrenceId, templateId) {
  const template = await db.tournament.findUnique({ where: { id: templateId } })
  if (!template?.autoOptOutAfterMissed) return

  const standings = await db.recurringTournamentRegistration.findMany({
    where: { templateId, optedOutAt: null },
  })

  for (const reg of standings) {
    // Check if they actually participated (registered and not withdrawn)
    const participated = await db.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId: occurrenceId, userId: reg.userId } },
    })

    if (!participated || participated.status === 'WITHDRAWN') {
      const newMissed = reg.missedCount + 1
      if (newMissed >= template.autoOptOutAfterMissed) {
        await db.recurringTournamentRegistration.update({
          where: { id: reg.id },
          data: { missedCount: newMissed, optedOutAt: new Date() },
        })
        logger.info(
          { templateId, userId: reg.userId, missedCount: newMissed },
          'Auto-opted out after consecutive misses'
        )
      } else {
        await db.recurringTournamentRegistration.update({
          where: { id: reg.id },
          data: { missedCount: newMissed },
        })
      }
    } else {
      // Reset missed count on participation
      if (reg.missedCount > 0) {
        await db.recurringTournamentRegistration.update({
          where: { id: reg.id },
          data: { missedCount: 0 },
        })
      }
    }
  }
}
