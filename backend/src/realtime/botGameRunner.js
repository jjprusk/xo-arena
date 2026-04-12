/**
 * BotGameRunner — server-side bot vs bot game execution.
 *
 * Each game runs in an async loop with a configurable delay between moves.
 * Spectators join via the standard socket room:join event.
 * Results are recorded to the DB and ELO is updated when the game ends.
 */

import { mountainPool, MountainNamePool } from './mountainNames.js'
import { getWinner, isBoardFull, getEmptyCells, WIN_LINES } from '@xo-arena/ai'
import registry from '../ai/registry.js'
import { createGame } from '../services/userService.js'
import { updateBothElosAfterBotVsBot } from '../services/eloService.js'
import db from '../lib/db.js'
import logger from '../logger.js'

const TOURNAMENT_SERVICE_URL = process.env.TOURNAMENT_SERVICE_URL || 'http://localhost:3001'

async function completeTournamentMatch(matchId, winnerId, p1Wins, p2Wins, drawGames) {
  try {
    const res = await fetch(`${TOURNAMENT_SERVICE_URL}/api/matches/${matchId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.INTERNAL_SECRET ? { 'x-internal-secret': process.env.INTERNAL_SECRET } : {}),
      },
      body: JSON.stringify({ winnerId, p1Wins, p2Wins, drawGames }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      logger.warn({ matchId, status: res.status, body }, 'completeTournamentMatch: non-2xx response')
    }
  } catch (err) {
    logger.error({ err, matchId }, 'completeTournamentMatch: fetch failed')
  }
}

const DEFAULT_MOVE_DELAY_MS = 800

/**
 * Parse a botModelId string into { impl, difficulty }.
 * Falls back to minimax/intermediate if the implementation isn't registered.
 */
function parseBotModelId(botModelId) {
  if (!botModelId) return { impl: 'minimax', difficulty: 'intermediate' }

  if (botModelId.startsWith('builtin:minimax:')) {
    const diff = botModelId.split(':')[2] || 'intermediate'
    return { impl: 'minimax', difficulty: diff }
  }

  if (botModelId.startsWith('testbot:')) {
    const diff = botModelId.split(':')[2] || 'novice'
    return { impl: 'minimax', difficulty: diff }
  }

  if (botModelId.startsWith('user:')) {
    const parts = botModelId.split(':')
    const algo = parts[2] || 'minimax'
    const diff = parts[3] || 'intermediate'
    const impl = registry.has(algo) ? algo : 'minimax'
    return { impl, difficulty: diff }
  }

  // ML model ID or unknown — fall back to minimax master
  logger.warn({ botModelId }, 'Unknown botModelId format — falling back to minimax/master')
  return { impl: 'minimax', difficulty: 'master' }
}

class BotGameRunner {
  constructor() {
    /** @type {Map<string, object>} slug → game state */
    this._games = new Map()
    /** @type {Map<string, string>} socketId → slug */
    this._socketToGame = new Map()
    /** @type {import('socket.io').Server|null} */
    this._io = null
  }

  setIO(io) {
    this._io = io
  }

  /**
   * Start a new bot vs bot game.
   * @param {object} opts
   * @param {{ id, displayName, botModelId }} opts.bot1 - plays X
   * @param {{ id, displayName, botModelId }} opts.bot2 - plays O
   * @param {number} [opts.moveDelayMs]
   * @param {string|null} [opts.tournamentId]
   * @param {string|null} [opts.tournamentMatchId]
   * @returns {{ slug, displayName }}
   */
  async startGame({ bot1, bot2, moveDelayMs = DEFAULT_MOVE_DELAY_MS, tournamentId = null, tournamentMatchId = null, bestOfN = 1 }) {
    const name = mountainPool.acquire()
    if (!name) throw new Error('No mountain names available for bot game')

    const slug = MountainNamePool.toSlug(name)
    const now = Date.now()

    const game = {
      slug,
      displayName: `Mt. ${name}`,
      name,
      bot1,   // plays X
      bot2,   // plays O
      board: Array(9).fill(null),
      currentTurn: 'X',
      status: 'playing',
      winner: null,
      winLine: null,
      spectatorIds: new Set(),
      createdAt: now,
      lastActivityAt: now,
      moveDelayMs,
      tournamentId,
      tournamentMatchId,
      bestOfN: bestOfN ?? 1,
      seriesBot1Wins: 0,
      seriesBot2Wins: 0,
      seriesDraws: 0,
      seriesGamesPlayed: 0,
    }

    this._games.set(slug, game)
    logger.info({ slug, bot1: bot1.displayName, bot2: bot2.displayName, tournamentMatchId }, 'Bot game started')

    // Mark bots as in-tournament so they can't be trained mid-match
    if (tournamentMatchId) {
      await db.user.updateMany({
        where: { id: { in: [bot1.id, bot2.id] } },
        data: { botInTournament: true },
      }).catch(err => logger.warn({ err }, 'Failed to set botInTournament flag'))
    }

    // Run the game loop asynchronously
    this._runGameLoop(slug).catch((err) => {
      logger.error({ err, slug }, 'Bot game loop error')
      this._closeGame(slug)
    })

    return { slug, displayName: game.displayName }
  }

  /**
   * Async game loop — drives moves until terminal state.
   * For best-of-N series, loops until a bot wins enough games or the hard cap is reached.
   */
  async _runGameLoop(slug) {
    const game = this._games.get(slug)
    if (!game) return

    // Validate bestOfN — must be a positive odd integer
    if (!game.bestOfN || game.bestOfN < 1 || game.bestOfN % 2 === 0) {
      logger.error({ slug, bestOfN: game.bestOfN }, 'Invalid bestOfN — must be a positive odd number. Defaulting to 1.')
      game.bestOfN = 1
    }

    const winsNeeded = Math.ceil(game.bestOfN / 2)
    // Hard cap: maximum possible games in a best-of-N series (e.g. best-of-3 → 5 max)
    const hardCap = Math.max(game.bestOfN * 2 - 1, 1)

    // Series loop
    while (true) {
      // Emit game:start for each game in the series
      this._io?.to(slug).emit('game:start', {
        board: game.board,
        currentTurn: game.currentTurn,
        round: game.seriesGamesPlayed + 1,
        bot1: { displayName: game.bot1.displayName, mark: 'X' },
        bot2: { displayName: game.bot2.displayName, mark: 'O' },
        seriesBot1Wins: game.seriesBot1Wins,
        seriesBot2Wins: game.seriesBot2Wins,
      })

      // Play until terminal state
      while (game.status === 'playing') {
        await new Promise((r) => setTimeout(r, game.moveDelayMs))

        if (!this._games.has(slug)) return

        const bot = game.currentTurn === 'X' ? game.bot1 : game.bot2
        const { impl, difficulty } = parseBotModelId(bot.botModelId)

        let cellIndex
        try {
          const aiImpl = registry.get(impl)
          cellIndex = await aiImpl.move(game.board, difficulty, game.currentTurn)
        } catch (err) {
          logger.error({ err, slug, bot: bot.displayName }, 'Bot move failed — forfeiting game')
          game.winner = game.currentTurn === 'X' ? 'O' : 'X'
          game.status = 'finished'
          this._io?.to(slug).emit('game:moved', {
            cellIndex: null,
            board: game.board,
            currentTurn: game.currentTurn,
            status: game.status,
            winner: game.winner,
            winLine: null,
            forfeit: true,
          })
          break
        }

        game.board[cellIndex] = game.currentTurn
        game.lastActivityAt = Date.now()

        const winner = getWinner(game.board)
        const draw = !winner && isBoardFull(game.board)

        if (winner) {
          game.winner = winner
          game.winLine = WIN_LINES.find(([a, b, c]) =>
            game.board[a] === winner && game.board[b] === winner && game.board[c] === winner
          ) || null
          game.status = 'finished'
        } else if (draw) {
          game.status = 'finished'
          game.winner = null
        } else {
          game.currentTurn = game.currentTurn === 'X' ? 'O' : 'X'
        }

        this._io?.to(slug).emit('game:moved', {
          cellIndex,
          board: game.board,
          currentTurn: game.currentTurn,
          status: game.status,
          winner: game.winner,
          winLine: game.winLine,
        })
      }

      // Update series counters after this game
      if (game.winner === 'X') game.seriesBot1Wins++
      else if (game.winner === 'O') game.seriesBot2Wins++
      else game.seriesDraws++
      game.seriesGamesPlayed++

      // Check if series is decided
      const seriesDone =
        game.seriesBot1Wins >= winsNeeded ||
        game.seriesBot2Wins >= winsNeeded ||
        game.seriesGamesPlayed >= hardCap

      if (seriesDone) break

      // Brief pause between games, then reset board for next game
      await new Promise((r) => setTimeout(r, 2000))
      if (!this._games.has(slug)) return

      game.board = Array(9).fill(null)
      game.currentTurn = 'X'
      game.status = 'playing'
      game.winner = null
      game.winLine = null
      game.createdAt = Date.now()
      game.lastActivityAt = Date.now()
    }

    // Record the finished series
    await this._recordGame(slug).catch((err) => logger.warn({ err, slug }, 'Failed to record bot game'))

    // Clean up after a short delay (so late-joining spectators still see the result)
    setTimeout(() => this._closeGame(slug), 60_000)
  }

  async _recordGame(slug) {
    const game = this._games.get(slug)
    if (!game) return

    const totalMoves = game.board.filter(Boolean).length
    const durationMs = game.lastActivityAt - game.createdAt

    const isTournamentGame = !!(game.tournamentMatchId)

    // For series: derive winner from accumulated series counters.
    // Random tiebreaker if still tied after hard cap (e.g. all draws).
    let seriesWinnerId = null
    if (game.seriesBot1Wins > game.seriesBot2Wins) {
      seriesWinnerId = game.bot1.id
    } else if (game.seriesBot2Wins > game.seriesBot1Wins) {
      seriesWinnerId = game.bot2.id
    } else if (isTournamentGame) {
      // Tied after hard cap — deterministic tiebreaker derived from matchId
      // so the same match always resolves the same way (auditable, reproducible).
      const idSum = game.tournamentMatchId
        .split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
      seriesWinnerId = idSum % 2 === 0 ? game.bot1.id : game.bot2.id
      logger.info(
        { slug, tournamentMatchId: game.tournamentMatchId, winner: seriesWinnerId === game.bot1.id ? game.bot1.displayName : game.bot2.displayName },
        'Bot series tied at hard cap — deterministic tiebreaker applied'
      )
    }

    // Outcome from bot1 (X) perspective for the last game (used for single-game ELO)
    let outcome = 'DRAW'
    if (game.winner === 'X') outcome = 'PLAYER1_WIN'
    else if (game.winner === 'O') outcome = 'PLAYER2_WIN'

    // Bug #11: separate DB record write from tournament completion so a DB error
    // can't silently prevent bracket advancement.
    await createGame({
      player1Id: game.bot1.id,
      player2Id: game.bot2.id,
      winnerId: seriesWinnerId,
      mode: 'BOTVBOT',
      outcome: seriesWinnerId === game.bot1.id ? 'PLAYER1_WIN' : seriesWinnerId === game.bot2.id ? 'PLAYER2_WIN' : 'DRAW',
      totalMoves,
      durationMs,
      startedAt: new Date(game.createdAt),
      tournamentId: game.tournamentId ?? null,
      tournamentMatchId: game.tournamentMatchId ?? null,
    }).catch(err => logger.warn({ err, slug }, 'Failed to write bot game record — will still attempt tournament completion'))

    if (!isTournamentGame) {
      await updateBothElosAfterBotVsBot(game.bot1.id, game.bot2.id, outcome).catch(() => {})
      await db.user.updateMany({
        where: { id: { in: [game.bot1.id, game.bot2.id] }, botInTournament: true },
        data: { botInTournament: false },
      }).catch(() => {})
    }

    // Report series result to tournament service for bracket progression
    if (isTournamentGame) {
      try {
        const winnerParticipant = seriesWinnerId
          ? await db.tournamentParticipant.findFirst({
              where: { tournamentId: game.tournamentId, userId: seriesWinnerId },
              select: { id: true },
            })
          : null
        await completeTournamentMatch(
          game.tournamentMatchId,
          winnerParticipant?.id ?? null,
          game.seriesBot1Wins,
          game.seriesBot2Wins,
          game.seriesDraws,
        )
      } catch (err) {
        logger.warn({ err, tournamentMatchId: game.tournamentMatchId }, 'Failed to report bot tournament match result')
      }

      await db.user.updateMany({
        where: { id: { in: [game.bot1.id, game.bot2.id] }, botInTournament: true },
        data: { botInTournament: false },
      }).catch(err => logger.warn({ err }, 'Failed to clear botInTournament flag after tournament game'))
    }

    logger.info(
      { slug, seriesBot1Wins: game.seriesBot1Wins, seriesBot2Wins: game.seriesBot2Wins, seriesDraws: game.seriesDraws, gamesPlayed: game.seriesGamesPlayed, tournamentMatchId: game.tournamentMatchId ?? null },
      'Bot series recorded'
    )
  }

  /**
   * A socket joins as spectator.
   * Returns { game } or { error }.
   */
  joinAsSpectator({ slug, socketId }) {
    const game = this._games.get(slug)
    if (!game) return { error: 'Bot game not found' }
    game.spectatorIds.add(socketId)
    this._socketToGame.set(socketId, slug)
    return { game }
  }

  /**
   * Remove a spectator (on disconnect).
   */
  removeSpectator(socketId) {
    const slug = this._socketToGame.get(socketId)
    if (!slug) return
    const game = this._games.get(slug)
    game?.spectatorIds.delete(socketId)
    this._socketToGame.delete(socketId)
  }

  hasSlug(slug) {
    return this._games.has(slug)
  }

  getGame(slug) {
    return this._games.get(slug) || null
  }

  /** List active/playing bot games for the room list. */
  listGames() {
    return [...this._games.values()]
      .filter((g) => g.status === 'playing')
      .map((g) => ({
        slug: g.slug,
        displayName: g.displayName,
        status: g.status,
        spectatorCount: g.spectatorIds.size,
        spectatorAllowed: true,
        isBotGame: true,
        bot1: { displayName: g.bot1.displayName },
        bot2: { displayName: g.bot2.displayName },
      }))
  }

  _closeGame(slug) {
    const game = this._games.get(slug)
    if (!game) return
    // Clean up socket mappings
    for (const id of game.spectatorIds) {
      this._socketToGame.delete(id)
    }
    this._games.delete(slug)
    mountainPool.release(game.name)
    logger.info({ slug }, 'Bot game closed')
  }
}

export const botGameRunner = new BotGameRunner()
