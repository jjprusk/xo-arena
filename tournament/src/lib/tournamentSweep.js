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
  recoverPendingBotMatches().catch(err => logger.warn({ err }, 'Tournament sweep — startup recovery failed'))
  sweep()
  return setInterval(sweep, SWEEP_INTERVAL_MS)
}

// How long a bot match must be PENDING before the sweep re-publishes it
const BOT_MATCH_STALE_MS = 2 * 60_000

/**
 * On startup, re-publish tournament:bot:match:ready for any PENDING bot matches
 * in IN_PROGRESS tournaments. This recovers from events lost during a backend restart.
 */
async function recoverPendingBotMatches(onlyStale = false) {
  const matchFilter = onlyStale
    ? { status: 'PENDING', createdAt: { lte: new Date(Date.now() - BOT_MATCH_STALE_MS) } }
    : { status: 'PENDING' }
  const inProgress = await db.tournament.findMany({
    where: { status: 'IN_PROGRESS', mode: 'BOT_VS_BOT' },
    include: {
      rounds: {
        include: {
          matches: { where: matchFilter },
        },
      },
    },
  })

  let recovered = 0
  for (const t of inProgress) {
    for (const round of t.rounds) {
      for (const match of round.matches) {
        if (!match.participant1Id || !match.participant2Id) continue

        const [p1, p2] = await Promise.all([
          db.tournamentParticipant.findUnique({
            where: { id: match.participant1Id },
            include: { user: { select: { id: true, displayName: true, botModelId: true } } },
          }),
          db.tournamentParticipant.findUnique({
            where: { id: match.participant2Id },
            include: { user: { select: { id: true, displayName: true, botModelId: true } } },
          }),
        ])

        if (!p1?.user || !p2?.user) continue

        await publish('tournament:bot:match:ready', {
          tournamentId: t.id,
          matchId: match.id,
          bestOfN: t.bestOfN,
          bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
          bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
        }).catch(() => {})
        recovered++
      }
    }
  }

  if (recovered > 0) {
    logger.info({ recovered }, 'Tournament sweep — re-published pending bot matches on startup')
  }
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

    // Partition by startMode: AUTO starts immediately, others just close registration
    const autoStart   = sufficient.filter(t => t.startMode === 'AUTO')
    const nonAuto     = sufficient.filter(t => t.startMode !== 'AUTO')

    if (nonAuto.length > 0) {
      await db.tournament.updateMany({
        where: { id: { in: nonAuto.map(t => t.id) } },
        data: { status: 'REGISTRATION_CLOSED' },
      })
      for (const t of nonAuto) {
        logger.info({ tournamentId: t.id, name: t.name, startMode: t.startMode }, 'Tournament sweep — registration closed')
        await publish('tournament:registration_closed', { tournamentId: t.id, name: t.name }).catch(() => {})
      }
    }

    // AUTO mode: start immediately on registration close (re-fetch for full user data)
    for (const t of autoStart) {
      await publish('tournament:registration_closed', { tournamentId: t.id, name: t.name }).catch(() => {})
      const full = await db.tournament.findUnique({
        where: { id: t.id },
        include: {
          participants: {
            where: { status: { in: ['REGISTERED', 'ACTIVE'] } },
            include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true } } },
          },
        },
      })
      if (full) {
        logger.info({ tournamentId: t.id, name: t.name }, 'Tournament sweep — AUTO mode, starting on registration close')
        await autoStartTournament(full)
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
          include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true } } },
        },
      },
    })
  } catch (err) {
    logger.error({ err }, 'Tournament sweep — DB query failed')
    return
  }

  if (overdue.length === 0) {
    // Phase 3 even when no overdue tournaments
    await recoverPendingBotMatches(true)
    return
  }
  logger.info({ count: overdue.length }, 'Tournament sweep — processing overdue tournaments')

  for (const t of overdue) {
    // MANUAL mode: sweep never starts these — admin uses the Start button
    if (t.startMode === 'MANUAL') continue

    const count = t.participants.length
    if (count < t.minParticipants) {
      await autoCancel(t, count)
    } else {
      await autoStartTournament(t)
    }
  }

  // Phase 3: re-publish events for bot matches stuck in PENDING (event may have been lost)
  await recoverPendingBotMatches(true)
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
      name: tournament.name,
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

async function autoStartTournament(tournament) {
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
              participant1UserId: p1.user.betterAuthId,
              participant2UserId: p2.user.betterAuthId,
              bestOfN: tournament.bestOfN,
            })
          } else {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              bestOfN: tournament.bestOfN,
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
              participant1UserId: p1.user.betterAuthId,
              participant2UserId: p2.user.betterAuthId,
              bestOfN: tournament.bestOfN,
            })
          } else {
            await publish('tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: match.id,
              bestOfN: tournament.bestOfN,
              bot1: { id: p1.user.id, displayName: p1.user.displayName, botModelId: p1.user.botModelId },
              bot2: { id: p2.user.id, displayName: p2.user.displayName, botModelId: p2.user.botModelId },
            })
          }
        }
      }
    }

    await publish('tournament:started', { tournamentId: tournament.id, name: tournament.name }).catch(() => {})
    logger.info(
      { tournamentId: tournament.id, name: tournament.name, participants: participants.length },
      'Tournament sweep — auto-started'
    )
  } catch (err) {
    logger.warn({ tournamentId: tournament.id, err: err.message }, 'Tournament sweep — auto-start failed')
  }
}
