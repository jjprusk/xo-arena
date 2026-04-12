import { Router } from 'express'
import db from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { requireTournamentAdminOrInternal } from '../middleware/auth.js'
import logger from '../logger.js'

const router = Router()

// POST /api/matches/:matchId/complete
router.post('/:matchId/complete', requireTournamentAdminOrInternal, async (req, res, next) => {
  try {
    const { matchId } = req.params
    const { p1Wins, p2Wins, drawGames, winnerId } = req.body

    const match = await db.tournamentMatch.findUnique({
      where: { id: matchId },
      include: { round: true },
    })

    if (!match) return res.status(404).json({ error: 'Match not found' })
    if (match.status !== 'PENDING' && match.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: `Match is already ${match.status.toLowerCase()}` })
    }

    // ── Phase 1: Update match, eliminate loser, award points ─────────────────
    // Kept in its own transaction so it commits quickly before we check round
    // completion. Bracket advancement happens in Phase 2, outside this tx.
    const matchPublishes = []

    await db.$transaction(async (tx) => {
      await tx.tournamentMatch.update({
        where: { id: matchId },
        data: { status: 'COMPLETED', p1Wins, p2Wins, drawGames, winnerId, completedAt: new Date() },
      })

      const loserId = winnerId
        ? [match.participant1Id, match.participant2Id].find(id => id && id !== winnerId)
        : null

      if (loserId) {
        await tx.tournamentParticipant.update({
          where: { id: loserId },
          data: { status: 'ELIMINATED' },
        })
      }

      const tournament = await tx.tournament.findUnique({ where: { id: match.tournamentId } })

      if (tournament.bracketType === 'ROUND_ROBIN') {
        if (winnerId) {
          await tx.tournamentParticipant.update({
            where: { id: winnerId },
            data: { points: { increment: 2 } },
          })
        } else {
          const drawIds = [match.participant1Id, match.participant2Id].filter(Boolean)
          for (const pId of drawIds) {
            await tx.tournamentParticipant.update({
              where: { id: pId },
              data: { points: { increment: 1 } },
            })
          }
        }
      }
    })

    // Publish match result immediately after Phase 1 commits
    matchPublishes.push(['tournament:match:result', {
      tournamentId: match.tournamentId,
      matchId,
      winnerId,
      p1Wins,
      p2Wins,
      drawGames,
    }])
    for (const [channel, payload] of matchPublishes) {
      await publish(channel, payload).catch(err =>
        logger.warn({ err, channel }, 'Failed to publish match:result event')
      )
    }

    res.json({ match: { id: matchId, status: 'COMPLETED' } })

    // ── Phase 2: Bracket advancement — runs AFTER Phase 1 commits ────────────
    // Fresh read of all round matches so we see committed state from concurrent
    // requests. Atomic updateMany gate (WHERE status = IN_PROGRESS) ensures
    // only one concurrent call performs the advancement even if multiple matches
    // complete at the same instant.
    setImmediate(() => advanceBracketIfReady(match).catch(err =>
      logger.error({ err, matchId, roundId: match.roundId }, 'Bracket advancement failed')
    ))
  } catch (e) {
    next(e)
  }
})

async function advanceBracketIfReady(match) {
  // Re-read all round matches with committed state
  const roundMatches = await db.tournamentMatch.findMany({
    where: { roundId: match.roundId },
  })

  const allCompleted = roundMatches.every(m => m.status === 'COMPLETED')
  if (!allCompleted) return

  // Atomic gate: only the first caller to flip IN_PROGRESS → COMPLETED wins
  const closed = await db.tournamentRound.updateMany({
    where: { id: match.roundId, status: 'IN_PROGRESS' },
    data: { status: 'COMPLETED' },
  })
  if (closed.count === 0) return  // another concurrent request already advanced

  const tournament = await db.tournament.findUnique({ where: { id: match.tournamentId } })
  const pendingPublishes = []

  if (tournament.bracketType === 'SINGLE_ELIM') {
    const winners = roundMatches.filter(m => m.winnerId).map(m => m.winnerId)
    const loserPosition = winners.length + 1

    const loserIds = roundMatches
      .filter(m => m.participant1Id && m.participant2Id && m.winnerId)
      .map(m => [m.participant1Id, m.participant2Id].find(id => id !== m.winnerId))
      .filter(Boolean)

    if (loserIds.length > 0) {
      await db.tournamentParticipant.updateMany({
        where: { id: { in: loserIds } },
        data: { finalPosition: loserPosition },
      })
    }

    if (winners.length === 1) {
      // ── Tournament complete ──────────────────────────────────────────────
      const totalParticipants = await db.tournamentParticipant.count({
        where: { tournamentId: tournament.id },
      })

      await db.tournamentParticipant.update({
        where: { id: winners[0] },
        data: { finalPosition: 1, finalPositionPct: 0 },
      })

      if (loserIds[0]) {
        const runnerUpPct = totalParticipants > 1 ? 1 / (totalParticipants - 1) : 0
        await db.tournamentParticipant.update({
          where: { id: loserIds[0] },
          data: { finalPositionPct: runnerUpPct },
        })
      }

      await db.tournament.update({
        where: { id: tournament.id },
        data: { status: 'COMPLETED', endTime: new Date() },
      })

      const winnerPart = await db.tournamentParticipant.findUnique({
        where: { id: winners[0] },
        include: { user: { select: { id: true } } },
      })
      const runnerUpPart = loserIds[0]
        ? await db.tournamentParticipant.findUnique({
            where: { id: loserIds[0] },
            include: { user: { select: { id: true } } },
          })
        : null

      const finalStandings = [
        ...(winnerPart ? [{ userId: winnerPart.user.id, position: 1 }] : []),
        ...(runnerUpPart ? [{ userId: runnerUpPart.user.id, position: 2 }] : []),
      ]

      pendingPublishes.push(['tournament:completed', {
        tournamentId: tournament.id,
        name: tournament.name,
        finalStandings,
      }])
    } else {
      // ── Advance to next round ────────────────────────────────────────────
      const round = await db.tournamentRound.findUnique({ where: { id: match.roundId } })
      const nextRound = await db.tournamentRound.create({
        data: {
          tournamentId: tournament.id,
          roundNumber: round.roundNumber + 1,
          status: 'IN_PROGRESS',
        },
      })

      const winnerParticipants = await db.tournamentParticipant.findMany({
        where: { id: { in: winners } },
        include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true } } },
      })

      if (winnerParticipants.length !== winners.length) {
        const found = new Set(winnerParticipants.map(p => p.id))
        const missing = winners.filter(id => !found.has(id))
        logger.error({ missing, tournamentId: tournament.id }, 'Winner participants missing from DB — aborting round advancement')
        throw new Error('Winner participants not found — cannot advance bracket')
      }

      const participantMap = Object.fromEntries(winnerParticipants.map(p => [p.id, p]))

      for (let i = 0; i < winners.length; i += 2) {
        const p1Id = winners[i]
        const p2Id = winners[i + 1]

        if (!p2Id) {
          const byePart = participantMap[p1Id]
          if (!byePart) {
            logger.warn({ p1Id, tournamentId: tournament.id }, 'Bye participant not found — skipping')
            continue
          }
          await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: nextRound.id,
              participant1Id: p1Id,
              participant2Id: null,
              winnerId: p1Id,
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          })
        } else {
          const newMatch = await db.tournamentMatch.create({
            data: {
              tournamentId: tournament.id,
              roundId: nextRound.id,
              participant1Id: p1Id,
              participant2Id: p2Id,
              status: 'PENDING',
            },
          })

          const p1 = participantMap[p1Id]
          const p2 = participantMap[p2Id]

          if (tournament.mode === 'PVP') {
            pendingPublishes.push(['tournament:match:ready', {
              tournamentId: tournament.id,
              matchId: newMatch.id,
              participant1UserId: p1?.user.betterAuthId,
              participant2UserId: p2?.user.betterAuthId,
              bestOfN: tournament.bestOfN,
            }])
          } else {
            pendingPublishes.push(['tournament:bot:match:ready', {
              tournamentId: tournament.id,
              matchId: newMatch.id,
              bestOfN: tournament.bestOfN,
              bot1: { id: p1?.user.id, displayName: p1?.user.displayName, botModelId: p1?.user.botModelId },
              bot2: { id: p2?.user.id, displayName: p2?.user.displayName, botModelId: p2?.user.botModelId },
            }])
          }
        }
      }
    }

  } else if (tournament.bracketType === 'ROUND_ROBIN') {
    const allRounds = await db.tournamentRound.findMany({
      where: { tournamentId: tournament.id },
      include: { matches: true },
    })
    const allRoundsDone = allRounds.every(r => r.matches.every(m => m.status === 'COMPLETED'))

    if (allRoundsDone) {
      const participants = await db.tournamentParticipant.findMany({
        where: { tournamentId: tournament.id },
        include: { user: { select: { id: true } } },
        orderBy: [{ points: 'desc' }, { eloAtRegistration: 'desc' }],
      })

      const total = participants.length

      for (let i = 0; i < participants.length; i++) {
        const position = i + 1
        const finalPositionPct = total > 1 ? (position - 1) / (total - 1) : 0
        await db.tournamentParticipant.update({
          where: { id: participants[i].id },
          data: { finalPosition: position, finalPositionPct },
        })
      }

      const finalStandings = participants.map((p, i) => ({
        userId: p.user.id,
        position: i + 1,
      }))

      await db.tournament.update({
        where: { id: tournament.id },
        data: { status: 'COMPLETED', endTime: new Date() },
      })

      pendingPublishes.push(['tournament:completed', {
        tournamentId: tournament.id,
        name: tournament.name,
        finalStandings,
      }])
    }
  }

  for (const [channel, payload] of pendingPublishes) {
    await publish(channel, payload).catch(err =>
      logger.warn({ err, channel }, 'Failed to publish event after bracket advancement')
    )
  }
}

export default router
