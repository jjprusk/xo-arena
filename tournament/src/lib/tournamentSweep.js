/**
 * Tournament sweep job — runs every 60 seconds.
 *
 * Phase 1 — close registration:
 *   For every REGISTRATION_OPEN tournament whose registrationCloseAt is in the past:
 *   - participants < minParticipants → auto-cancel immediately
 *   - participants >= minParticipants → transition to REGISTRATION_CLOSED
 *
 * Phase 2 — start or cancel:
 *   For every REGISTRATION_OPEN or REGISTRATION_CLOSED tournament whose
 *   startTime is in the past:
 *   - participants >= minParticipants → auto-start (generate bracket + publish events)
 *   - participants <  minParticipants → auto-cancel  (publish cancelled event)
 */

import db from './db.js'
import { publish } from './redis.js'
import logger from '../logger.js'

const SWEEP_INTERVAL_MS = 60_000

export function startTournamentSweep() {
  logger.info('Tournament sweep job started (60s interval)')
  sweep()
  return setInterval(sweep, SWEEP_INTERVAL_MS)
}

async function sweep() {
  const now = new Date()

  // Phase 1: close registration for tournaments past their registrationCloseAt
  // If participant count < minParticipants at close time, cancel immediately.
  try {
    const toClose = await db.tournament.findMany({
      where: {
        status: 'REGISTRATION_OPEN',
        registrationCloseAt: { not: null, lte: now },
      },
      include: {
        participants: {
          where: { status: { in: ['REGISTERED', 'ACTIVE'] } },
          include: { user: { select: { id: true } } },
        },
      },
    })
    const insufficient = toClose.filter(t => t.participants.length < t.minParticipants)
    const sufficient   = toClose.filter(t => t.participants.length >= t.minParticipants)

    // Cancel tournaments that closed with too few participants
    for (const t of insufficient) {
      await autoCancel(t, t.participants.length)
    }

    // Close registration for the rest
    if (sufficient.length > 0) {
      await db.tournament.updateMany({
        where: { id: { in: sufficient.map(t => t.id) } },
        data: { status: 'REGISTRATION_CLOSED' },
      })
      for (const t of sufficient) {
        logger.info({ tournamentId: t.id, name: t.name }, 'Tournament sweep — registration closed')
        await publish('tournament:registration_closed', { tournamentId: t.id, name: t.name }).catch(() => {})
      }
    }
  } catch (err) {
    logger.error({ err }, 'Tournament sweep — registration close phase failed')
  }

  // Phase 2: start or cancel tournaments past their startTime
  let overdue
  try {
    overdue = await db.tournament.findMany({
      where: {
        status: { in: ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'] },
        startTime: { not: null, lte: now },
      },
      include: {
        participants: {
          where: { status: { in: ['REGISTERED', 'ACTIVE'] } },
          include: { user: { select: { id: true, displayName: true, botModelId: true } } },
        },
      },
    })
  } catch (err) {
    logger.error({ err }, 'Tournament sweep — DB query failed')
    return
  }

  if (overdue.length === 0) return
  logger.info({ count: overdue.length }, 'Tournament sweep — processing overdue tournaments')

  for (const t of overdue) {
    const count = t.participants.length

    if (count < t.minParticipants) {
      await autoCancel(t, count)
    } else {
      await autoStart(t)
    }
  }
}

// ─── Auto-cancel ──────────────────────────────────────────────────────────────

async function autoCancel(tournament, count) {
  try {
    await db.tournament.update({
      where: { id: tournament.id },
      data: { status: 'CANCELLED' },
    })

    const participantUserIds = tournament.participants.map(p => p.userId)
    await publish('tournament:cancelled', {
      tournamentId: tournament.id,
      participantUserIds,
    })

    logger.info(
      { tournamentId: tournament.id, name: tournament.name, participants: count, min: tournament.minParticipants },
      'Tournament sweep — auto-cancelled (insufficient participants)'
    )
  } catch (err) {
    logger.warn({ tournamentId: tournament.id, err: err.message }, 'Tournament sweep — auto-cancel failed')
  }
}

// ─── Auto-start ───────────────────────────────────────────────────────────────

async function autoStart(tournament) {
  try {
    await db.tournament.update({
      where: { id: tournament.id },
      data: { status: 'IN_PROGRESS' },
    })

    const participants = tournament.participants

    if (tournament.bracketType === 'SINGLE_ELIM') {
      const shuffled = [...participants].sort(() => Math.random() - 0.5)

      const round = await db.tournamentRound.create({
        data: { tournamentId: tournament.id, roundNumber: 1, status: 'IN_PROGRESS' },
      })

      for (let i = 0; i < shuffled.length; i += 2) {
        const p1 = shuffled[i]
        const p2 = shuffled[i + 1]

        if (!p2) {
          // Bye
          await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: round.id,
              participant1Id: p1.id,
              participant2Id: null,
              winnerId: p1.id,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          })
        } else {
          const match = await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: round.id,
              participant1Id: p1.id,
              participant2Id: p2.id,
              status: 'PENDING',
            },
          })

          if (tournament.mode === 'PVP') {
            await publish('tournament:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              participant1UserId: p1.user.id,
              participant2UserId: p2.user.id,
              bestOfN: tournament.bestOfN,
            })
          } else {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
          }
        }
      }
    } else if (tournament.bracketType === 'ROUND_ROBIN') {
      const round = await db.tournamentRound.create({
        data: { tournamentId: tournament.id, roundNumber: 1, status: 'IN_PROGRESS' },
      })

      for (let i = 0; i < participants.length; i++) {
        for (let j = i + 1; j < participants.length; j++) {
          const p1 = participants[i]
          const p2 = participants[j]

          const match = await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: round.id,
              participant1Id: p1.id,
              participant2Id: p2.id,
              status: 'PENDING',
            },
          })

          if (tournament.mode === 'PVP') {
            await publish('tournament:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              participant1UserId: p1.user.id,
              participant2UserId: p2.user.id,
              bestOfN: tournament.bestOfN,
            })
          } else {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
          }
        }
      }
    }

    logger.info(
      { tournamentId: tournament.id, name: tournament.name, participants: participants.length },
      'Tournament sweep — auto-started'
    )
  } catch (err) {
    logger.warn({ tournamentId: tournament.id, err: err.message }, 'Tournament sweep — auto-start failed')
  }
}
