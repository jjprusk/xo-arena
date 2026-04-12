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

    // Collect Redis publishes — fired after the transaction commits so events
    // only go out if the DB writes all succeeded.
    const pendingPublishes = []

    const updatedMatch = await db.$transaction(async (tx) => {
      // ── 1. Mark match COMPLETED ──────────────────────────────────────────────
      const completed = await tx.tournamentMatch.update({
        where: { id: matchId },
        data: { status: 'COMPLETED', p1Wins, p2Wins, drawGames, winnerId, completedAt: new Date() },
      })

      // ── 2. Eliminate loser (non-bye matches only) ────────────────────────────
      const loserId = winnerId
        ? [match.participant1Id, match.participant2Id].find(id => id && id !== winnerId)
        : null

      if (loserId) {
        await tx.tournamentParticipant.update({
          where: { id: loserId },
          data: { status: 'ELIMINATED' },
        })
      }

      // ── 3. Award ROUND_ROBIN points ──────────────────────────────────────────
      const tournament = await tx.tournament.findUnique({ where: { id: match.tournamentId } })

      if (tournament.bracketType === 'ROUND_ROBIN') {
        if (winnerId) {
          // Win: +2 for winner, +0 for loser
          await tx.tournamentParticipant.update({
            where: { id: winnerId },
            data: { points: { increment: 2 } },
          })
        } else {
          // Draw: +1 for both
          const drawIds = [match.participant1Id, match.participant2Id].filter(Boolean)
          for (const pId of drawIds) {
            await tx.tournamentParticipant.update({
              where: { id: pId },
              data: { points: { increment: 1 } },
            })
          }
        }
      }

      pendingPublishes.push(['tournament:match:result', {
        tournamentId: match.tournamentId,
        matchId,
        winnerId,
        p1Wins,
        p2Wins,
        drawGames,
      }])

      // ── 4. Check if round is fully complete ──────────────────────────────────
      const roundMatches = await tx.tournamentMatch.findMany({
        where: { roundId: match.roundId },
      })
      const allCompleted = roundMatches.every(m => m.status === 'COMPLETED')
      if (!allCompleted) return completed

      await tx.tournamentRound.update({
        where: { id: match.roundId },
        data: { status: 'COMPLETED' },
      })

      // ── 5. SINGLE_ELIM: advance or complete ──────────────────────────────────
      if (tournament.bracketType === 'SINGLE_ELIM') {
        const winners = roundMatches.filter(m => m.winnerId).map(m => m.winnerId)
        const loserPosition = winners.length + 1

        // Set finalPosition on all losers of this round
        const loserIds = roundMatches
          .filter(m => m.participant1Id && m.participant2Id && m.winnerId)
          .map(m => [m.participant1Id, m.participant2Id].find(id => id !== m.winnerId))
          .filter(Boolean)

        if (loserIds.length > 0) {
          await tx.tournamentParticipant.updateMany({
            where: { id: { in: loserIds } },
            data: { finalPosition: loserPosition },
          })
        }

        if (winners.length === 1) {
          // ── Tournament complete ────────────────────────────────────────────
          const totalParticipants = await tx.tournamentParticipant.count({
            where: { tournamentId: tournament.id },
          })

          // Set winner's finalPosition and finalPositionPct
          const finalPositionPct = totalParticipants > 1
            ? 0  // winner is always 0 (best)
            : 0
          await tx.tournamentParticipant.update({
            where: { id: winners[0] },
            data: { finalPosition: 1, finalPositionPct },
          })

          // Set runner-up's finalPositionPct too (position 2, already set above)
          if (loserIds[0]) {
            const runnerUpPct = totalParticipants > 1 ? 1 / (totalParticipants - 1) : 0
            await tx.tournamentParticipant.update({
              where: { id: loserIds[0] },
              data: { finalPositionPct: runnerUpPct },
            })
          }

          await tx.tournament.update({
            where: { id: tournament.id },
            data: { status: 'COMPLETED', endTime: new Date() },
          })

          const winnerPart = await tx.tournamentParticipant.findUnique({
            where: { id: winners[0] },
            include: { user: { select: { id: true } } },
          })
          const runnerUpPart = loserIds[0]
            ? await tx.tournamentParticipant.findUnique({
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
          // ── Advance to next round ──────────────────────────────────────────
          const nextRound = await tx.tournamentRound.create({
            data: {
              tournamentId: tournament.id,
              roundNumber: match.round.roundNumber + 1,
              status: 'IN_PROGRESS',
            },
          })

          const winnerParticipants = await tx.tournamentParticipant.findMany({
            where: { id: { in: winners } },
            include: { user: { select: { id: true, betterAuthId: true, displayName: true, botModelId: true } } },
          })

          // Bug #12: validate all winner records were found
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
              // Bye — validate participant exists first
              const byePart = participantMap[p1Id]
              if (!byePart) {
                logger.warn({ p1Id, tournamentId: tournament.id }, 'Bye participant not found — skipping')
                continue
              }
              await tx.tournamentMatch.create({
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
              const newMatch = await tx.tournamentMatch.create({
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
                // Bug fix: publish betterAuthId, not CUID
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

      // ── 6. ROUND_ROBIN: check if all matches complete ─────────────────────
      } else if (tournament.bracketType === 'ROUND_ROBIN') {
        const allRounds = await tx.tournamentRound.findMany({
          where: { tournamentId: tournament.id },
          include: { matches: true },
        })
        const allRoundsDone = allRounds.every(r => r.matches.every(m => m.status === 'COMPLETED'))

        if (allRoundsDone) {
          // Bug #14: order by points DESC, then eloAtRegistration DESC as tie-breaker
          const participants = await tx.tournamentParticipant.findMany({
            where: { tournamentId: tournament.id },
            include: { user: { select: { id: true } } },
            orderBy: [{ points: 'desc' }, { eloAtRegistration: 'desc' }],
          })

          const total = participants.length

          // Bug #3 + #15: set finalPosition and finalPositionPct on all participants
          for (let i = 0; i < participants.length; i++) {
            const position = i + 1
            const finalPositionPct = total > 1 ? (position - 1) / (total - 1) : 0
            await tx.tournamentParticipant.update({
              where: { id: participants[i].id },
              data: { finalPosition: position, finalPositionPct },
            })
          }

          const finalStandings = participants.map((p, i) => ({
            userId: p.user.id,
            position: i + 1,
          }))

          await tx.tournament.update({
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

      return completed
    })

    // Fire all Redis events after the transaction committed successfully
    for (const [channel, payload] of pendingPublishes) {
      await publish(channel, payload).catch(err =>
        logger.warn({ err, channel }, 'Failed to publish event after match completion')
      )
    }

    res.json({ match: updatedMatch })
  } catch (e) {
    next(e)
  }
})

export default router
