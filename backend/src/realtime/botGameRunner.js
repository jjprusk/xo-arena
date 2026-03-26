/**
 * BotGameRunner — server-side bot vs bot game execution.
 *
 * Each game runs in an async loop with a configurable delay between moves.
 * Spectators join via the standard socket room:join event.
 * Results are recorded to the DB and ELO is updated when the game ends.
 */

import { mountainPool, MountainNamePool } from './mountainNames.js'
import { getWinner, isBoardFull, getEmptyCells, WIN_LINES } from '../ai/gameLogic.js'
import registry from '../ai/registry.js'
import { createGame } from '../services/userService.js'
import { updateBothElosAfterBotVsBot } from '../services/eloService.js'
import logger from '../logger.js'

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

  if (botModelId.startsWith('user:')) {
    const parts = botModelId.split(':')
    const algo = parts[2] || 'minimax'
    const diff = parts[3] || 'intermediate'
    const impl = registry.has(algo) ? algo : 'minimax'
    return { impl, difficulty: diff }
  }

  // ML model ID or unknown — fall back to minimax master
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
   * @returns {{ slug, displayName }}
   */
  async startGame({ bot1, bot2, moveDelayMs = DEFAULT_MOVE_DELAY_MS }) {
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
    }

    this._games.set(slug, game)
    logger.info({ slug, bot1: bot1.displayName, bot2: bot2.displayName }, 'Bot game started')

    // Run the game loop asynchronously
    this._runGameLoop(slug).catch((err) => {
      logger.error({ err, slug }, 'Bot game loop error')
      this._closeGame(slug)
    })

    return { slug, displayName: game.displayName }
  }

  /**
   * Async game loop — drives moves until terminal state.
   */
  async _runGameLoop(slug) {
    const game = this._games.get(slug)
    if (!game) return

    // Emit game:start to all spectators
    this._io?.to(slug).emit('game:start', {
      board: game.board,
      currentTurn: game.currentTurn,
      round: 1,
      bot1: { displayName: game.bot1.displayName, mark: 'X' },
      bot2: { displayName: game.bot2.displayName, mark: 'O' },
    })

    while (game.status === 'playing') {
      await new Promise((r) => setTimeout(r, game.moveDelayMs))

      // Re-fetch in case the game was closed externally
      if (!this._games.has(slug)) return

      const bot = game.currentTurn === 'X' ? game.bot1 : game.bot2
      const { impl, difficulty } = parseBotModelId(bot.botModelId)

      let cellIndex
      try {
        const aiImpl = registry.get(impl)
        cellIndex = await aiImpl.move(game.board, difficulty, game.currentTurn)
      } catch (err) {
        logger.warn({ err, slug, bot: bot.displayName }, 'Bot move failed — picking random cell')
        const empty = getEmptyCells(game.board)
        if (empty.length === 0) break
        cellIndex = empty[Math.floor(Math.random() * empty.length)]
      }

      // Apply move
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

      // Broadcast move
      this._io?.to(slug).emit('game:moved', {
        cellIndex,
        board: game.board,
        currentTurn: game.currentTurn,
        status: game.status,
        winner: game.winner,
        winLine: game.winLine,
      })
    }

    // Record the finished game
    await this._recordGame(slug).catch((err) => logger.warn({ err, slug }, 'Failed to record bot game'))

    // Clean up after a short delay (so late-joining spectators still see the result)
    setTimeout(() => this._closeGame(slug), 60_000)
  }

  async _recordGame(slug) {
    const game = this._games.get(slug)
    if (!game || game.status !== 'finished') return

    const totalMoves = game.board.filter(Boolean).length
    const durationMs = game.lastActivityAt - game.createdAt

    // Outcome from bot1 (X) perspective
    let outcome = 'DRAW'
    if (game.winner === 'X') outcome = 'PLAYER1_WIN'
    else if (game.winner === 'O') outcome = 'PLAYER2_WIN'

    let winnerId = null
    if (game.winner === 'X') winnerId = game.bot1.id
    else if (game.winner === 'O') winnerId = game.bot2.id

    await createGame({
      player1Id: game.bot1.id,
      player2Id: game.bot2.id,
      winnerId,
      mode: 'BOTVBOT',
      outcome,
      totalMoves,
      durationMs,
      startedAt: new Date(game.createdAt),
    })

    // Update ELO for both bots
    await updateBothElosAfterBotVsBot(game.bot1.id, game.bot2.id, outcome).catch(() => {})

    logger.info({ slug, outcome, winner: game.winner }, 'Bot game recorded')
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
