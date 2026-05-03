import { describe, it, expect, beforeEach, vi } from 'vitest'

// All vi.mock() calls must precede the dynamic import of the module under test.

// Deterministic slug for tests — nanoid is otherwise random.
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'testslug'),
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

vi.mock('../services/skillService.js', () => ({
  getMoveForModel: vi.fn().mockResolvedValue(0),
}))

const { mockTournamentMatchUpdate, mockTableCreate, mockTableFindFirst } = vi.hoisted(() => ({
  mockTournamentMatchUpdate: vi.fn().mockResolvedValue({}),
  mockTableCreate:           vi.fn().mockResolvedValue({ id: 'tbl-created' }),
  mockTableFindFirst:        vi.fn().mockResolvedValue(null),
}))
vi.mock('../../lib/db.js', () => ({
  default: {
    user:            { updateMany: vi.fn().mockResolvedValue({}) },
    table:           { findFirst: mockTableFindFirst, create: mockTableCreate },
    tournamentMatch: { update: mockTournamentMatchUpdate },
  },
}))

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: mockAppendToStream }))

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
    displayName: 'Bot1 vs Bot2',
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
  mockAppendToStream.mockClear()
  mockTournamentMatchUpdate.mockClear()
  mockTableCreate.mockClear()
  mockTableFindFirst.mockClear()
  mockTableFindFirst.mockResolvedValue(null)
  mockTableCreate.mockResolvedValue({ id: 'tbl-created' })
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
// startGame
// ---------------------------------------------------------------------------

describe('startGame', () => {
  it('mints a nanoid slug and synthesises a label from the bot names', async () => {
    const { nanoid } = await import('nanoid')
    nanoid.mockReturnValueOnce('abc12345')

    const result = await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      moveDelayMs: 9_999_999,
    })

    expect(result).toEqual({ slug: 'abc12345', displayName: 'Bot1 vs Bot2' })
  })

  it('uses an explicit slug when the caller provides one', async () => {
    const result = await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      slug: 'demo-xyz',
      moveDelayMs: 9_999_999,
    })

    expect(result.slug).toBe('demo-xyz')
  })

  it('flips tournamentMatch.status to IN_PROGRESS when starting a tournament bot match', async () => {
    // Without this flip, the cup follow-modal stays in "waiting" mode for
    // the entire match: it polls tournament.rounds[*].matches[*].status
    // and only switches to live when a match is IN_PROGRESS.
    await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      slug: 'cup-match-1',
      moveDelayMs: 9_999_999,
      tournamentId: 't1',
      tournamentMatchId: 'm1',
    })

    expect(mockTournamentMatchUpdate).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data:  { status: 'IN_PROGRESS' },
    })
  })

  it('mints a backing Table for tournament bot matches when none exists', async () => {
    // Without a Table row, the standard /rt/tables/:slug/join path 404s
    // (TABLE_NOT_FOUND) when a cup spectator follows their bot, even though
    // the bot game is running in memory.
    await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      slug: 'cup-match-2',
      moveDelayMs: 9_999_999,
      tournamentId: 't1',
      tournamentMatchId: 'm1',
      bestOfN: 1,
    })

    expect(mockTableCreate).toHaveBeenCalledTimes(1)
    const args = mockTableCreate.mock.calls[0][0]
    expect(args.data).toMatchObject({
      gameId:            'xo',
      slug:              'cup-match-2',
      isTournament:      true,
      tournamentMatchId: 'm1',
      tournamentId:      't1',
      status:            'ACTIVE',
    })
    expect(args.data.seats).toHaveLength(2)
  })

  it('does not create a backing Table when one already exists for the slug (spar/demo path)', async () => {
    mockTableFindFirst.mockResolvedValueOnce({ id: 'pre-existing-tbl' })
    await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      slug: 'demo-existing',
      moveDelayMs: 9_999_999,
      tournamentId: 't1',
      tournamentMatchId: 'm1',
    })
    expect(mockTableCreate).not.toHaveBeenCalled()
  })

  it('does not create a backing Table for non-tournament bot games', async () => {
    await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      slug: 'free-bot-no-table',
      moveDelayMs: 9_999_999,
    })
    expect(mockTableCreate).not.toHaveBeenCalled()
  })

  it('does not call tournamentMatch.update for non-tournament bot games', async () => {
    await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      slug: 'free-bot-game',
      moveDelayMs: 9_999_999,
    })
    expect(mockTournamentMatchUpdate).not.toHaveBeenCalled()
  })

  it('emits a kind=start frame on table:<slug>:state for SSE spectators', async () => {
    await botGameRunner.startGame({
      bot1: { id: 'b1', displayName: 'Bot1', botModelId: null },
      bot2: { id: 'b2', displayName: 'Bot2', botModelId: null },
      slug: 'sse-emit',
      moveDelayMs: 9_999_999,
    })
    // _runGameLoop is fire-and-forget. Yield the event loop several times so
    // the loop's start emit fires before we assert.
    for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r))

    expect(mockAppendToStream).toHaveBeenCalledWith(
      'table:sse-emit:state',
      expect.objectContaining({
        kind:        'start',
        currentTurn: 'X',
        round:       1,
      }),
      { userId: '*' },
    )
  })
})
