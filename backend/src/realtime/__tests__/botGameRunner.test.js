import { describe, it, expect, beforeEach, vi } from 'vitest'

// All vi.mock() calls must precede the dynamic import of the module under test.

vi.mock('../mountainNames.js', () => ({
  mountainPool: { acquire: vi.fn(() => 'Everest'), release: vi.fn() },
  MountainNamePool: { toSlug: vi.fn((name) => name.toLowerCase()) },
}))

vi.mock('@xo-arena/ai', () => ({
  getWinner: vi.fn(() => null),
  isBoardFull: vi.fn(() => false),
  getEmptyCells: vi.fn(() => [0, 1, 2, 3, 4, 5, 6, 7, 8]),
  WIN_LINES: [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ],
  minimaxImplementation: { name: 'minimax', move: vi.fn() },
  mlImplementation: { name: 'ml', move: vi.fn() },
  ruleBasedImplementation: { name: 'rule_based', move: vi.fn() },
}))

vi.mock('../../ai/registry.js', () => ({
  default: { has: vi.fn(() => true), get: vi.fn() },
}))

vi.mock('../services/userService.js', () => ({
  createGame: vi.fn(),
}))

vi.mock('../services/eloService.js', () => ({
  updateBothElosAfterBotVsBot: vi.fn(),
}))

vi.mock('../lib/db.js', () => ({
  default: { user: { updateMany: vi.fn() } },
}))

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const { botGameRunner } = await import('../botGameRunner.js')

// ---------------------------------------------------------------------------
// Shared test fixture — a game that will never advance (moveDelayMs huge)
// ---------------------------------------------------------------------------

function makeMockGame(overrides = {}) {
  return {
    slug: 'test-slug',
    displayName: 'Mt. Test',
    name: 'Test',
    bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
    bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
    board: Array(9).fill(null),
    currentTurn: 'X',
    status: 'playing',
    winner: null,
    winLine: null,
    spectatorIds: new Set(),
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    moveDelayMs: 9_999_999, // prevent the async loop from progressing during tests
    ...overrides,
  }
}

beforeEach(() => {
  botGameRunner._games.clear()
  botGameRunner._socketToGame.clear()
})

// ---------------------------------------------------------------------------
// hasSlug
// ---------------------------------------------------------------------------

describe('hasSlug', () => {
  it('returns false for an unknown slug', () => {
    expect(botGameRunner.hasSlug('no-such-slug')).toBe(false)
  })

  it('returns true for a known slug', () => {
    botGameRunner._games.set('known-slug', makeMockGame({ slug: 'known-slug' }))
    expect(botGameRunner.hasSlug('known-slug')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getGame
// ---------------------------------------------------------------------------

describe('getGame', () => {
  it('returns null for an unknown slug', () => {
    expect(botGameRunner.getGame('nope')).toBeNull()
  })

  it('returns the game for a known slug', () => {
    const game = makeMockGame()
    botGameRunner._games.set(game.slug, game)
    expect(botGameRunner.getGame(game.slug)).toBe(game)
  })
})

// ---------------------------------------------------------------------------
// joinAsSpectator
// ---------------------------------------------------------------------------

describe('joinAsSpectator', () => {
  it('returns { error } for an unknown slug', () => {
    const result = botGameRunner.joinAsSpectator({ slug: 'missing', socketId: 's1' })
    expect(result).toHaveProperty('error')
    expect(result.error).toBeTruthy()
  })

  it('returns { game } and registers the socketId for a known slug', () => {
    const game = makeMockGame()
    botGameRunner._games.set(game.slug, game)

    const result = botGameRunner.joinAsSpectator({ slug: game.slug, socketId: 'socket-1' })

    expect(result).toHaveProperty('game')
    expect(result.game).toBe(game)
    expect(game.spectatorIds.has('socket-1')).toBe(true)
    expect(botGameRunner._socketToGame.get('socket-1')).toBe(game.slug)
  })
})

// ---------------------------------------------------------------------------
// removeSpectator
// ---------------------------------------------------------------------------

describe('removeSpectator', () => {
  it('removes the socketId from spectatorIds and _socketToGame', () => {
    const game = makeMockGame()
    botGameRunner._games.set(game.slug, game)
    botGameRunner.joinAsSpectator({ slug: game.slug, socketId: 'socket-2' })

    expect(game.spectatorIds.has('socket-2')).toBe(true)

    botGameRunner.removeSpectator('socket-2')

    expect(game.spectatorIds.has('socket-2')).toBe(false)
    expect(botGameRunner._socketToGame.has('socket-2')).toBe(false)
  })

  it('is a no-op for an unknown socketId', () => {
    expect(() => botGameRunner.removeSpectator('ghost')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// listGames
// ---------------------------------------------------------------------------

describe('listGames', () => {
  it('returns only games with status="playing", not "finished"', () => {
    botGameRunner._games.set('playing-slug', makeMockGame({ slug: 'playing-slug', status: 'playing' }))
    botGameRunner._games.set('done-slug', makeMockGame({ slug: 'done-slug', status: 'finished' }))

    const list = botGameRunner.listGames()

    expect(list).toHaveLength(1)
    expect(list[0].slug).toBe('playing-slug')
  })

  it('returned game summary has the correct shape', () => {
    const game = makeMockGame()
    game.spectatorIds.add('viewer-1')
    botGameRunner._games.set(game.slug, game)

    const [summary] = botGameRunner.listGames()

    expect(summary).toMatchObject({
      slug: game.slug,
      displayName: game.displayName,
      status: 'playing',
      spectatorCount: 1,
      spectatorAllowed: true,
      isBotGame: true,
      bot1: { displayName: 'Bot1' },
      bot2: { displayName: 'Bot2' },
    })
  })
})

// ---------------------------------------------------------------------------
// setIO
// ---------------------------------------------------------------------------

describe('setIO', () => {
  it('stores the io instance on _io', () => {
    const fakeIo = { to: vi.fn() }
    botGameRunner.setIO(fakeIo)
    expect(botGameRunner._io).toBe(fakeIo)
    // clean up so other tests start with _io = null
    botGameRunner.setIO(null)
  })
})

// ---------------------------------------------------------------------------
// startGame
// ---------------------------------------------------------------------------

describe('startGame', () => {
  it('throws when mountainPool.acquire returns null', async () => {
    const { mountainPool } = await import('../mountainNames.js')
    mountainPool.acquire.mockReturnValueOnce(null)

    await expect(
      botGameRunner.startGame({
        bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
        bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      })
    ).rejects.toThrow('No mountain names available')
  })

  it('returns { slug, displayName } when a name is available', async () => {
    const { mountainPool, MountainNamePool } = await import('../mountainNames.js')
    mountainPool.acquire.mockReturnValueOnce('Everest')
    MountainNamePool.toSlug.mockReturnValueOnce('everest')

    const result = await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      moveDelayMs: 9_999_999,
    })

    expect(result).toHaveProperty('slug', 'everest')
    expect(result).toHaveProperty('displayName', 'Mt. Everest')
  })
})
