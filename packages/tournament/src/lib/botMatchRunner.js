/**
 * Bot match runner — runs a complete best-of-N game series between two bot participants.
 */

import db from '@xo-arena/db'
import { minimaxMove, getWinner, isBoardFull } from '@xo-arena/ai'
import logger from '../logger.js'

/**
 * Parse botModelId → { impl, difficulty }
 * Supports: 'builtin:minimax:novice|intermediate|advanced|master'
 * Fallback: { impl: 'minimax', difficulty: 'master' }
 *
 * @param {string|null} botModelId
 * @returns {{ impl: string, difficulty: string }}
 */
function parseBotModelId(botModelId) {
  if (botModelId && botModelId.startsWith('builtin:minimax:')) {
    const parts = botModelId.split(':')
    const difficulty = parts[2] ?? 'master'
    return { impl: 'minimax', difficulty }
  }
  return { impl: 'minimax', difficulty: 'master' }
}

/**
 * Get a move for the given board state and bot config.
 *
 * @param {Array<string|null>} board - 9-element board array
 * @param {'X'|'O'} player - mark the bot is playing
 * @param {string|null} botModelId
 * @returns {number} cell index 0–8
 */
function getBotMove(board, player, botModelId) {
  const { difficulty } = parseBotModelId(botModelId)
  return minimaxMove(board, difficulty, player)
}

/**
 * Run a single tic-tac-toe game between two bots.
 * p1Bot plays X, p2Bot plays O.
 *
 * @param {string|null} p1BotModelId
 * @param {string|null} p2BotModelId
 * @returns {{ outcome: 'PLAYER1_WIN'|'PLAYER2_WIN'|'DRAW', totalMoves: number }}
 */
function runSingleGame(p1BotModelId, p2BotModelId) {
  const board = Array(9).fill(null)
  let totalMoves = 0

  while (true) {
    // X turn (player 1)
    const xMove = getBotMove(board, 'X', p1BotModelId)
    board[xMove] = 'X'
    totalMoves++

    const xWinner = getWinner(board)
    if (xWinner === 'X') return { outcome: 'PLAYER1_WIN', totalMoves }
    if (isBoardFull(board)) return { outcome: 'DRAW', totalMoves }

    // O turn (player 2)
    const oMove = getBotMove(board, 'O', p2BotModelId)
    board[oMove] = 'O'
    totalMoves++

    const oWinner = getWinner(board)
    if (oWinner === 'O') return { outcome: 'PLAYER2_WIN', totalMoves }
    if (isBoardFull(board)) return { outcome: 'DRAW', totalMoves }
  }
}

/**
 * Run a complete best-of-N series between two bot participants.
 *
 * @param {string} matchId - TournamentMatch ID
 * @returns {Promise<{ winnerId: string, p1Wins: number, p2Wins: number, drawGames: number }>}
 *   winnerId is the TournamentParticipant ID of the winner
 */
export async function runBotMatchSeries(matchId) {
  // 1. Fetch match with tournament info
  const match = await db.tournamentMatch.findUnique({
    where: { id: matchId },
    include: {
      tournament: { select: { id: true, bestOfN: true } },
    },
  })
  if (!match) throw new Error(`Match not found: ${matchId}`)

  // 2. Fetch participant users
  const [p1Participant, p2Participant] = await Promise.all([
    db.tournamentParticipant.findUnique({
      where: { id: match.participant1Id },
      include: { user: { select: { id: true, botModelId: true } } },
    }),
    db.tournamentParticipant.findUnique({
      where: { id: match.participant2Id },
      include: { user: { select: { id: true, botModelId: true } } },
    }),
  ])

  if (!p1Participant) throw new Error(`Participant 1 not found for match: ${matchId}`)
  if (!p2Participant) throw new Error(`Participant 2 not found for match: ${matchId}`)

  // 3. Run games until series winner
  const bestOfN = match.tournament.bestOfN ?? 3
  const winsNeeded = Math.ceil(bestOfN / 2)
  let p1Wins = 0
  let p2Wins = 0
  let drawGames = 0

  logger.info(
    { matchId, bestOfN, winsNeeded, p1BotModelId: p1Participant.user.botModelId, p2BotModelId: p2Participant.user.botModelId },
    'Bot match series starting'
  )

  while (p1Wins < winsNeeded && p2Wins < winsNeeded) {
    const gameResult = runSingleGame(p1Participant.user.botModelId, p2Participant.user.botModelId)

    // 4. Write Game record to DB
    const startedAt = new Date()
    await db.game.create({
      data: {
        player1Id: p1Participant.user.id,
        player2Id: p2Participant.user.id,
        winnerId:
          gameResult.outcome === 'PLAYER1_WIN' ? p1Participant.user.id
          : gameResult.outcome === 'PLAYER2_WIN' ? p2Participant.user.id
          : null,
        mode: 'BOTVBOT',
        outcome: gameResult.outcome,
        totalMoves: gameResult.totalMoves,
        durationMs: 0,
        startedAt,
        tournamentId: match.tournament.id,
        tournamentMatchId: matchId,
      },
    })

    if (gameResult.outcome === 'PLAYER1_WIN') p1Wins++
    else if (gameResult.outcome === 'PLAYER2_WIN') p2Wins++
    else drawGames++
  }

  // 5. Determine winner participant ID
  const winnerId = p1Wins >= winsNeeded ? match.participant1Id : match.participant2Id

  logger.info({ matchId, p1Wins, p2Wins, drawGames, winnerId }, 'Bot match series completed')
  return { winnerId, p1Wins, p2Wins, drawGames }
}
