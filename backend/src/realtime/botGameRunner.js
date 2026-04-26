// Copyright © 2026 Joe Pruskowski. All rights reserved.
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
import { getMoveForModel } from '../services/skillService.js'
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

const DEFAULT_MOVE_DELAY_MS = 1500

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

  if (botModelId.startsWith('testbot:') || botModelId.startsWith('seed:')) {
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

  // Raw ML skill ID (UUID) — use ML implementation with this skill
  return { impl: 'ml', difficulty: 'intermediate' }
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
  async startGame({ bot1, bot2, gameId = 'xo', moveDelayMs = DEFAULT_MOVE_DELAY_MS, tournamentId = null, tournamentMatchId = null, bestOfN = 1, slug: explicitSlug = null, displayName: explicitDisplayName = null, mountainName: explicitMountainName = null, isSpar = false, sparUserId = null }) {
    // Demo Table macro (§5.1) pre-allocates a slug + displayName so the Table
    // row's slug matches the bot-game slug. The caller passes `mountainName`
    // to transfer ownership — the runner releases it on game close exactly
    // like a self-acquired name.
    let name
    let slug
    let displayName
    if (explicitSlug) {
      name = explicitMountainName  // may be null if caller doesn't want pool tracking
      slug = explicitSlug
      displayName = explicitDisplayName ?? MountainNamePool.fromSlug(explicitSlug)
    } else {
      name = mountainPool.acquire()
      if (!name) throw new Error('No mountain names available for bot game')
      slug = MountainNamePool.toSlug(name)
      displayName = `Mt. ${name}`
    }

    const now = Date.now()

    const game = {
      slug,
      displayName,
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
      gameId,
      tournamentId,
      tournamentMatchId,
      bestOfN: bestOfN ?? 1,
      seriesBot1Wins: 0,
      seriesBot2Wins: 0,
      seriesDraws: 0,
      seriesGamesPlayed: 0,
      moves: [],  // compact move stream for replay
      isSpar,
      sparUserId,  // owner of bot1 — receives Hook step 5 credit on series completion
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
      game.moves = []
      const gameStartedAt = new Date(game.createdAt)

      // Emit game:start for each game in the series
      this._io?.to(slug).emit('game:start', {
        board: game.board,
        currentTurn: game.currentTurn,
        round: game.seriesGamesPlayed + 1,
        scores: { X: game.seriesBot1Wins, O: game.seriesBot2Wins },
        bot1: { displayName: game.bot1.displayName, mark: 'X' },
        bot2: { displayName: game.bot2.displayName, mark: 'O' },
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
          cellIndex = await aiImpl.move(game.board, difficulty, game.currentTurn, bot.botModelId)
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
            scores: { X: game.seriesBot1Wins, O: game.seriesBot2Wins },
          })
          break
        }

        game.board[cellIndex] = game.currentTurn
        game.lastActivityAt = Date.now()
        game.moves.push({ n: game.moves.length + 1, m: game.currentTurn, c: cellIndex })

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
          scores: { X: game.seriesBot1Wins, O: game.seriesBot2Wins },
        })
      }

      // Save a DB record for this individual game in the series
      const gameWinnerId = game.winner === 'X' ? game.bot1.id : game.winner === 'O' ? game.bot2.id : null
      const gameOutcome = game.winner === 'X' ? 'PLAYER1_WIN' : game.winner === 'O' ? 'PLAYER2_WIN' : 'DRAW'
      await createGame({
        player1Id: game.bot1.id,
        player2Id: game.bot2.id,
        winnerId: gameWinnerId,
        mode: 'BVB',
        outcome: gameOutcome,
        totalMoves: game.board.filter(Boolean).length,
        durationMs: game.lastActivityAt - game.createdAt,
        startedAt: gameStartedAt,
        tournamentId: game.tournamentId ?? null,
        tournamentMatchId: game.tournamentMatchId ?? null,
        moveStream: game.moves.length ? game.moves : null,
        isSpar: !!game.isSpar,
      }).catch(err => logger.warn({ err, slug }, 'Failed to write per-game bot record'))

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

    // Outcome from bot1 (X) perspective for the last game (used for ELO)
    let outcome = 'DRAW'
    if (game.winner === 'X') outcome = 'PLAYER1_WIN'
    else if (game.winner === 'O') outcome = 'PLAYER2_WIN'

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

    // Demo Table macro (§5.1): if a Table row was created with this bot game's
    // slug, mark it COMPLETED so the demo-table GC sweep can delete it after
    // the 2-min grace window. No-op for tournament/free bot games that don't
    // have a Table row.
    const demoTable = await db.table.findFirst({
      where:  { slug, isDemo: true },
      select: { id: true, status: true },
    }).catch(() => null)

    if (demoTable) {
      if (demoTable.status !== 'COMPLETED') {
        await db.table.update({
          where: { id: demoTable.id },
          data:  { status: 'COMPLETED' },
        }).catch(err => logger.warn({ err: err.message, slug }, 'Failed to mark demo table COMPLETED'))
      }

      // "Spectated to completion" — credit Hook step 2 for any authenticated
      // viewer currently watching, even if they haven't hit the 2-min mark
      // yet. Lazy-imported to keep this module free of journey/service deps
      // at module-eval time.
      try {
        const { getPresence } = await import('./tablePresence.js')
        const { completeStep } = await import('../services/journeyService.js')
        const { userIds = [] } = getPresence(demoTable.id) ?? {}
        for (const userId of userIds) {
          completeStep(userId, 2).catch(() => {})
        }
      } catch (err) {
        logger.warn({ err: err.message, slug }, 'Demo: completion-credit broadcast failed')
      }
    }

    // Spar series: credit Hook step 5 to the user who initiated the spar.
    // Lazy-imported to avoid pulling journeyService into this module's eval-
    // time graph (mirrors the demo-table step-2 pattern above).
    if (game.isSpar && game.sparUserId) {
      try {
        const { completeStep } = await import('../services/journeyService.js')
        completeStep(game.sparUserId, 5).catch(() => {})
      } catch (err) {
        logger.warn({ err: err.message, slug }, 'Spar: step-5 credit failed')
      }
    }

    logger.info(
      { slug, seriesBot1Wins: game.seriesBot1Wins, seriesBot2Wins: game.seriesBot2Wins, seriesDraws: game.seriesDraws, gamesPlayed: game.seriesGamesPlayed, tournamentMatchId: game.tournamentMatchId ?? null, isSpar: !!game.isSpar },
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

  getSlugForMatch(tournamentMatchId) {
    for (const game of this._games.values()) {
      if (game.tournamentMatchId === tournamentMatchId && game.status === 'playing') {
        return game.slug
      }
    }
    return null
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
    // Caller-supplied slugs (Demo Table macro) bypass the mountain pool — only
    // release names we acquired ourselves.
    if (game.name) mountainPool.release(game.name)
    logger.info({ slug }, 'Bot game closed')
  }

  /**
   * Force-close an in-flight bot game by slug. Used by the Demo Table macro's
   * "one active per user" policy: when a user starts a new demo, any prior
   * demo game is killed first. Idempotent — no-op if the slug isn't running.
   */
  closeGameBySlug(slug) {
    if (!this._games.has(slug)) return
    this._closeGame(slug)
  }

  /**
   * Find an in-flight spar match for a given user-bot id. Used by the Spar
   * endpoint's "one active spar per bot" policy — a new spar request kills
   * any previous in-flight spar for the same bot before starting fresh.
   * Returns the slug, or null if no active spar matches.
   */
  findActiveSparForBot(botId) {
    for (const game of this._games.values()) {
      if (game.isSpar && game.bot1?.id === botId && game.status === 'playing') {
        return game.slug
      }
    }
    return null
  }

  /**
   * Force-close any spar matches that have been alive longer than `maxAgeMs`
   * (default 2 hours). Catches stuck spars whose game loop hung — the runner
   * has no other timeout. Returns the slugs that were closed so the caller
   * can log a summary.
   */
  sweepStaleSpars(maxAgeMs = 2 * 60 * 60 * 1000) {
    const now    = Date.now()
    const closed = []
    for (const game of [...this._games.values()]) {
      if (!game.isSpar) continue
      if (now - game.createdAt > maxAgeMs) {
        this._closeGame(game.slug)
        closed.push(game.slug)
      }
    }
    return closed
  }
}

export const botGameRunner = new BotGameRunner()
