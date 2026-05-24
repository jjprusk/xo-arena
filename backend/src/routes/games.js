// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getUserByBetterAuthId, getBotByModelId, createGame } from '../services/userService.js'
import db from '../lib/db.js'
import { updatePlayerEloAfterPvAI, updateBothElosAfterPvBot, updateBothElosAfterMatch } from '../services/eloService.js'
import { recordGameCompletion } from '../services/creditService.js'
import { completeStep } from '../services/journeyService.js'
import { advanceMatchAfterGame } from '../services/rankedMatchOrchestrator.js'
import { rematchRankedTableInPlace } from '../services/tableFlowService.js'
import { appendToStream } from '../lib/eventStream.js'
import cache from '../utils/cache.js'
import logger from '../logger.js'

const router = Router()

// Maps frontend difficulty strings to Prisma Difficulty enum values
const DIFFICULTY_MAP = {
  novice: 'NOVICE',
  intermediate: 'INTERMEDIATE',
  advanced: 'ADVANCED',
  master: 'MASTER',
}

/**
 * POST /api/v1/games
 * Record a completed game for the authenticated user.
 *
 * HVA body: { mode: 'HVA', outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt }
 * HVB body: { mode: 'HVB', outcome, botModelId, totalMoves, durationMs, startedAt }
 * (mode defaults to 'HVA' for backwards compatibility)
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const user = await getUserByBetterAuthId(req.auth.userId)
    if (!user) return res.status(404).json({ error: 'User not found — sign in first' })

    const { outcome, difficulty, aiImplementationId, totalMoves, durationMs, startedAt, botModelId } = req.body
    const rawMode = req.body.mode ?? 'HVA'
    // Accept legacy mode strings from older clients
    const mode = rawMode === 'PVAI' ? 'HVA' : rawMode === 'PVBOT' ? 'HVB' : rawMode

    if (!outcome || totalMoves == null || durationMs == null || !startedAt) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    if (mode === 'HVB') {
      if (!botModelId) return res.status(400).json({ error: 'botModelId required for HVB games' })

      const bot = await getBotByModelId(botModelId)
      if (!bot) return res.status(404).json({ error: 'Bot not found' })
      if (!bot.botActive) return res.status(409).json({ error: 'Bot is inactive' })

      // Derive winnerId — player1 = human, player2 = bot
      let winnerId = null
      if (outcome === 'PLAYER1_WIN') winnerId = user.id
      else if (outcome === 'PLAYER2_WIN') winnerId = bot.id

      // Ranked-match context — when set, this game belongs to a BO2 Match
      // and we run the per-game lifecycle (record, then either advance to
      // game 2 or finalize) instead of the casual single-game update.
      const matchId       = req.body.matchId       ?? null
      const matchSequence = req.body.matchSequence ?? null
      const isRanked      = !!matchId

      const game = await createGame({
        player1Id: user.id,
        player2Id: bot.id,
        winnerId,
        mode: 'HVB',
        outcome,
        totalMoves,
        durationMs,
        startedAt,
        matchId,
        matchSequence,
      })

      let matchPayload = null
      if (isRanked) {
        try {
          const adv = await advanceMatchAfterGame({ matchId, winnerId })
          matchPayload = {
            id:        adv.match.id,
            status:    adv.match.status,
            p1Wins:    adv.match.p1Wins,
            p2Wins:    adv.match.p2Wins,
            drawGames: adv.match.drawGames,
            winnerId:  adv.match.winnerId,
            complete:  adv.complete,
            nextGame:  null,
          }

          // Resolve the in-flight table id once so we can address the
          // realtime channel without re-querying.
          const tableId = await db.table.findFirst({
            where:  { matchId },
            select: { id: true },
          }).then(r => r?.id ?? null).catch(() => null)

          if (!adv.complete && adv.nextSpawn) {
            // Reset the table in-place for game 2. Server stays the source
            // of truth on color — the response carries the new mark.
            const remix = await rematchRankedTableInPlace({ matchId, nextSpawn: adv.nextSpawn })
            if (remix) {
              matchPayload.nextGame = {
                sequence:    adv.nextSpawn.sequence,
                mark:        remix.humanMark,
                board:       remix.previewState.board,
                currentTurn: remix.previewState.currentTurn,
                humanIsFirstMover: adv.nextSpawn.firstMoverId === user.id,
              }
            }
          }

          // A2.7 — broadcast per-game and final lifecycle on the table's
          // state channel. Subscribers (player + spectators) re-render the
          // score / "next game" banner without polling.
          if (tableId) {
            appendToStream(
              `table:${tableId}:state`,
              {
                kind:         'match.gameComplete',
                matchId:      adv.match.id,
                sequence:     matchSequence,
                gameWinnerId: winnerId,
                p1Wins:       adv.match.p1Wins,
                p2Wins:       adv.match.p2Wins,
                drawGames:    adv.match.drawGames,
                complete:     adv.complete,
                nextSequence: adv.nextSpawn?.sequence ?? null,
              },
              { userId: '*' },
            ).catch(() => {})

            if (adv.complete) {
              appendToStream(
                `table:${tableId}:state`,
                {
                  kind:      'match.completed',
                  matchId:   adv.match.id,
                  winnerId:  adv.match.winnerId,
                  p1Wins:    adv.match.p1Wins,
                  p2Wins:    adv.match.p2Wins,
                  drawGames: adv.match.drawGames,
                  status:    adv.match.status,
                },
                { userId: '*' },
              ).catch(() => {})
            }
          }

          // A2.6 — match-level ELO update fires once on completion, using
          // the aggregated W/D/L totals from the Match row. Player1 of the
          // Match is always the human caller (see /play/ranked-bot);
          // player2 is the bot. Fire-and-forget so a transient DB blip on
          // the rating side can't 500 the response.
          if (adv.complete) {
            updateBothElosAfterMatch({
              player1Id: user.id,
              player2Id: bot.id,
              p1Wins:    adv.match.p1Wins,
              p2Wins:    adv.match.p2Wins,
              drawGames: adv.match.drawGames,
              isP2Bot:   true,
            }).catch(() => {})
          }
        } catch (err) {
          logger.warn({ err, matchId }, 'advanceMatchAfterGame failed')
        }
      }

      // Per-game ELO update for casual; the match-score path above handles
      // ranked. Both share the leaderboard cache flush.
      if (!isRanked) {
        updateBothElosAfterPvBot(user.id, bot.id, outcome).catch(() => {})
      }
      cache.invalidatePrefix('leaderboard:')

      // Record credits (fire-and-forget — failure must never block the response)
      const pvbotParticipants = [
        { userId: user.id, isBot: false, botOwnerId: null },
        { userId: bot.id, isBot: true, botOwnerId: bot.botOwnerId ?? null },
      ]
      recordGameCompletion({ appId: 'xo-arena', participants: pvbotParticipants, mode: 'hvb' })
        .catch((err) => logger.warn({ err }, 'Credit recording failed (non-fatal)'))

      // Journey step 1 (Hook): first PvAI game played (fire-and-forget)
      completeStep(user.id, 1).catch(() => {})

      return res.status(201).json({
        game: { id: game.id },
        ...(matchPayload ? { match: matchPayload } : {}),
      })
    }

    // Default: HVA
    let winnerId = null
    if (outcome === 'PLAYER1_WIN') winnerId = user.id

    const game = await createGame({
      player1Id: user.id,
      mode: 'HVA',
      outcome,
      winnerId,
      difficulty: DIFFICULTY_MAP[difficulty] || null,
      aiImplementationId: aiImplementationId || null,
      totalMoves,
      durationMs,
      startedAt,
    })

    // Update player ELO (fire-and-forget — non-fatal)
    updatePlayerEloAfterPvAI(user.id, outcome, difficulty).catch(() => {})
    cache.invalidatePrefix('leaderboard:')

    // Journey step 1 (Hook): first PvAI game played (fire-and-forget)
    completeStep(user.id, 1).catch(() => {})

    res.status(201).json({ game: { id: game.id } })
  } catch (err) {
    logger.error({ err }, 'Failed to record game')
    next(err)
  }
})

/**
 * GET /api/v1/games?tournamentMatchId=X
 * Returns the list of games played in a tournament match (best-of-N series).
 * No auth required — tournament results are public.
 */
router.get('/', async (req, res, next) => {
  try {
    const { tournamentMatchId } = req.query
    if (!tournamentMatchId) return res.status(400).json({ error: 'tournamentMatchId required' })
    const games = await db.game.findMany({
      where: { tournamentMatchId },
      select: {
        id: true, outcome: true, winnerId: true, totalMoves: true,
        startedAt: true, endedAt: true,
        player1: { select: { id: true, displayName: true } },
        player2: { select: { id: true, displayName: true } },
      },
      orderBy: { startedAt: 'asc' },
    })
    res.json({ games })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /api/v1/games/:id/replay
 * Returns a game record with its moveStream for replay.
 * Returns 404 if game not found, 410 if moveStream has been purged.
 */
router.get('/:id/replay', requireAuth, async (req, res, next) => {
  try {
    const game = await db.game.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        player1Id: true,
        player2Id: true,
        winnerId: true,
        outcome: true,
        totalMoves: true,
        durationMs: true,
        startedAt: true,
        endedAt: true,
        isTournament: true,
        moveStream: true,
        player1: { select: { id: true, displayName: true } },
        player2: { select: { id: true, displayName: true } },
      },
    })
    if (!game) return res.status(404).json({ error: 'Game not found' })
    if (game.moveStream === null) return res.status(410).json({ error: 'Replay has been purged' })
    res.json(game)
  } catch (err) {
    next(err)
  }
})

export default router
