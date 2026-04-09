import { Router } from 'express'
import db from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { requireTournamentAdmin } from '../middleware/auth.js'

const router = Router()

// POST /api/matches/:matchId/complete
router.post('/:matchId/complete', requireTournamentAdmin, async (req, res, next) => {
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

    const updatedMatch = await db.tournamentMatch.update({
      where: { id: matchId },
      data: {
        status: 'COMPLETED',
        p1Wins,
        p2Wins,
        drawGames,
        winnerId,
        completedAt: new Date(),
      },
    })

    await publish('tournament:match:result', {
      tournamentId: match.tournamentId,
      matchId,
      winnerId,
      p1Wins,
      p2Wins,
      drawGames,
    })

    // Check if all matches in the round are completed
    const roundMatches = await db.tournamentMatch.findMany({
      where: { roundId: match.roundId },
    })

    const allCompleted = roundMatches.every(m => m.status === 'COMPLETED')

    if (allCompleted) {
      await db.tournamentRound.update({
        where: { id: match.roundId },
        data: { status: 'COMPLETED' },
      })

      const tournament = await db.tournament.findUnique({
        where: { id: match.tournamentId },
      })

      if (tournament.bracketType === 'SINGLE_ELIM') {
        const winners = roundMatches
          .filter(m => m.winnerId)
          .map(m => m.winnerId)

        if (winners.length === 1) {
          // Tournament is over
          await db.tournament.update({
            where: { id: tournament.id },
            data: { status: 'COMPLETED', endTime: new Date() },
          })

          const winnerParticipant = await db.tournamentParticipant.findUnique({
            where: { id: winners[0] },
            include: { user: { select: { id: true } } },
          })

          await publish('tournament:completed', {
            tournamentId: tournament.id,
            finalStandings: winnerParticipant
              ? [{ userId: winnerParticipant.user.id, position: 1 }]
              : [],
          })
        } else {
          // Advance to next round
          const currentRound = match.round
          const nextRoundNumber = currentRound.roundNumber + 1

          const nextRound = await db.tournamentRound.create({
            data: {
              tournamentId: tournament.id,
              roundNumber: nextRoundNumber,
              status: 'IN_PROGRESS',
            },
          })

          // Load winner participant records to get user IDs
          const winnerParticipants = await db.tournamentParticipant.findMany({
            where: { id: { in: winners } },
            include: { user: { select: { id: true } } },
          })

          const participantMap = Object.fromEntries(
            winnerParticipants.map(p => [p.id, p])
          )

          for (let i = 0; i < winners.length; i += 2) {
            const p1Id = winners[i]
            const p2Id = winners[i + 1]

            if (!p2Id) {
              // Bye
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

              await publish('tournament:match:ready', {
                tournamentId: tournament.id,
                matchId: newMatch.id,
                participant1UserId: p1?.user.id,
                participant2UserId: p2?.user.id,
                bestOfN: tournament.bestOfN,
              })
            }
          }
        }
      } else if (tournament.bracketType === 'ROUND_ROBIN') {
        // Check if all rounds are done
        const allRounds = await db.tournamentRound.findMany({
          where: { tournamentId: tournament.id },
          include: { matches: true },
        })

        const allRoundsDone = allRounds.every(r =>
          r.matches.every(m => m.status === 'COMPLETED')
        )

        if (allRoundsDone) {
          // Compute standings by points
          const participants = await db.tournamentParticipant.findMany({
            where: { tournamentId: tournament.id },
            include: { user: { select: { id: true } } },
            orderBy: { points: 'desc' },
          })

          const finalStandings = participants.map((p, idx) => ({
            userId: p.user.id,
            position: idx + 1,
          }))

          await db.tournament.update({
            where: { id: tournament.id },
            data: { status: 'COMPLETED', endTime: new Date() },
          })

          await publish('tournament:completed', {
            tournamentId: tournament.id,
            finalStandings,
          })
        }
      }
    }

    res.json({ match: updatedMatch })
  } catch (e) {
    next(e)
  }
})

export default router
