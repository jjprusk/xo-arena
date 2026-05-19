import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
}))

vi.mock('../../services/userService.js', () => ({
  getUserByBetterAuthId: vi.fn(),
  getBotByModelId: vi.fn(),
  createGame: vi.fn(),
}))

vi.mock('../../services/eloService.js', () => ({
  updatePlayerEloAfterPvAI: vi.fn(async () => {}),
  updateBothElosAfterPvBot: vi.fn(async () => {}),
  updateBothElosAfterMatch: vi.fn(async () => {}),
}))

vi.mock('../../services/creditService.js', () => ({
  recordGameCompletion: vi.fn().mockResolvedValue([]),
}))

vi.mock('../../services/rankedMatchOrchestrator.js', () => ({
  advanceMatchAfterGame: vi.fn(),
}))

vi.mock('../../services/tableFlowService.js', () => ({
  rematchRankedTableInPlace: vi.fn(),
}))

vi.mock('../../lib/eventStream.js', () => ({
  appendToStream: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    table: { findFirst: vi.fn(async () => ({ id: 'tbl_match_1' })) },
  },
}))

const gamesRouter = (await import('../games.js')).default
const { getUserByBetterAuthId, getBotByModelId, createGame } =
  await import('../../services/userService.js')
const { updatePlayerEloAfterPvAI, updateBothElosAfterPvBot, updateBothElosAfterMatch } =
  await import('../../services/eloService.js')
const { recordGameCompletion } = await import('../../services/creditService.js')
const { advanceMatchAfterGame } = await import('../../services/rankedMatchOrchestrator.js')
const { rematchRankedTableInPlace } = await import('../../services/tableFlowService.js')
const { appendToStream } = await import('../../lib/eventStream.js')

const app = express()
app.use(express.json())
app.use('/api/v1/games', gamesRouter)

const mockUser = { id: 'usr_1', betterAuthId: 'ba_user_1' }
const mockBot = { id: 'bot_1', isBot: true, botModelId: 'builtin:minimax:novice', botActive: true }

const BASE_BODY = {
  outcome: 'PLAYER1_WIN',
  totalMoves: 5,
  durationMs: 3000,
  startedAt: new Date().toISOString(),
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserByBetterAuthId.mockResolvedValue(mockUser)
  createGame.mockResolvedValue({ id: 'game_1' })
})

describe('POST /api/v1/games — HVA (default)', () => {
  it('records a HVA game and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, difficulty: 'easy', aiImplementationId: 'minimax' })

    expect(res.status).toBe(201)
    expect(res.body.game.id).toBe('game_1')
    expect(createGame).toHaveBeenCalledWith(expect.objectContaining({ mode: 'HVA' }))
    expect(updatePlayerEloAfterPvAI).toHaveBeenCalledWith('usr_1', 'PLAYER1_WIN', 'easy')
  })

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ outcome: 'PLAYER1_WIN' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when user not found', async () => {
    getUserByBetterAuthId.mockResolvedValue(null)
    const res = await request(app).post('/api/v1/games').send(BASE_BODY)
    expect(res.status).toBe(404)
  })

  it('sets winnerId to null on AI win', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, outcome: 'AI_WIN' })
    expect(res.status).toBe(201)
    const call = createGame.mock.calls[0][0]
    expect(call.winnerId).toBeNull()
  })
})

describe('POST /api/v1/games — HVB', () => {
  beforeEach(() => {
    getBotByModelId.mockResolvedValue(mockBot)
  })

  it('records a HVB game and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'builtin:minimax:novice' })

    expect(res.status).toBe(201)
    expect(createGame).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'HVB', player2Id: 'bot_1' })
    )
    expect(updateBothElosAfterPvBot).toHaveBeenCalledWith('usr_1', 'bot_1', 'PLAYER1_WIN')
  })

  it('sets human as winner on PLAYER1_WIN', async () => {
    await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'builtin:minimax:novice', outcome: 'PLAYER1_WIN' })

    const call = createGame.mock.calls[0][0]
    expect(call.winnerId).toBe('usr_1')
  })

  it('sets bot as winner on PLAYER2_WIN', async () => {
    await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'builtin:minimax:novice', outcome: 'PLAYER2_WIN' })

    const call = createGame.mock.calls[0][0]
    expect(call.winnerId).toBe('bot_1')
  })

  it('returns 400 when botModelId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when bot not found', async () => {
    getBotByModelId.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'unknown:bot' })
    expect(res.status).toBe(404)
  })

  it('returns 409 when bot is inactive', async () => {
    getBotByModelId.mockResolvedValue({ ...mockBot, botActive: false })
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'builtin:minimax:novice' })
    expect(res.status).toBe(409)
  })

  it('does not call HVA ELO for HVB games', async () => {
    await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'builtin:minimax:novice' })
    expect(updatePlayerEloAfterPvAI).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Credits wiring (Phase 5)
// ---------------------------------------------------------------------------

describe('POST /api/v1/games — credit recording', () => {
  beforeEach(() => {
    getBotByModelId.mockResolvedValue(mockBot)
  })

  it('calls recordGameCompletion fire-and-forget for HVB games', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'builtin:minimax:novice' })
    expect(res.status).toBe(201)
    // Allow the async fire-and-forget to settle
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recordGameCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'xo-arena', mode: 'hvb' })
    )
    const call = recordGameCompletion.mock.calls[0][0]
    expect(call.participants).toContainEqual(expect.objectContaining({ userId: 'usr_1', isBot: false }))
    expect(call.participants).toContainEqual(expect.objectContaining({ userId: 'bot_1', isBot: true }))
  })

  it('does not call recordGameCompletion for HVA games', async () => {
    await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, difficulty: 'easy', aiImplementationId: 'minimax' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recordGameCompletion).not.toHaveBeenCalled()
  })

  it('credit failure does not affect the 201 response', async () => {
    recordGameCompletion.mockRejectedValueOnce(new Error('DB offline'))
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'HVB', botModelId: 'builtin:minimax:novice' })
    expect(res.status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// Ranked-match wiring (A2.4) — when the client POSTs a game with `matchId`,
// the route runs the BO2 lifecycle and either swaps the table for game 2 or
// finalizes the match.
// ---------------------------------------------------------------------------

describe('POST /api/v1/games — HVB ranked match', () => {
  beforeEach(() => {
    getBotByModelId.mockResolvedValue(mockBot)
  })

  it('stamps matchId + matchSequence on the Game row', async () => {
    advanceMatchAfterGame.mockResolvedValueOnce({
      complete: false,
      match: { id: 'm1', status: 'IN_PROGRESS', p1Wins: 1, p2Wins: 0, drawGames: 0, winnerId: null },
      nextSpawn: { sequence: 2, firstMoverId: 'bot_1', secondMoverId: 'usr_1', p1IsFirstMover: false },
    })
    rematchRankedTableInPlace.mockResolvedValueOnce({
      table: { id: 'tbl1' },
      previewState: { board: Array(9).fill(null), currentTurn: 'X' },
      humanMark: 'O',
      botMark:   'X',
    })

    await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
      matchId: 'm1',
      matchSequence: 1,
    })
    expect(createGame).toHaveBeenCalledWith(expect.objectContaining({
      matchId:       'm1',
      matchSequence: 1,
    }))
  })

  it('after game 1 returns nextGame metadata with swapped human mark', async () => {
    advanceMatchAfterGame.mockResolvedValueOnce({
      complete: false,
      match: { id: 'm1', status: 'IN_PROGRESS', p1Wins: 1, p2Wins: 0, drawGames: 0, winnerId: null },
      nextSpawn: { sequence: 2, firstMoverId: 'bot_1', secondMoverId: 'usr_1', p1IsFirstMover: false },
    })
    rematchRankedTableInPlace.mockResolvedValueOnce({
      table: { id: 'tbl1' },
      previewState: { board: Array(9).fill(null), currentTurn: 'X' },
      humanMark: 'O',
      botMark:   'X',
    })

    const res = await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
      matchId: 'm1',
      matchSequence: 1,
      outcome: 'PLAYER1_WIN',
    })

    expect(res.status).toBe(201)
    expect(res.body.match).toMatchObject({
      id:        'm1',
      status:    'IN_PROGRESS',
      complete:  false,
      p1Wins:    1,
      nextGame: {
        sequence:          2,
        mark:              'O',
        humanIsFirstMover: false,
      },
    })
    // ELO is deferred to match-complete for ranked play.
    expect(updateBothElosAfterPvBot).not.toHaveBeenCalled()
  })

  it('after game 2 returns complete=true and no nextGame', async () => {
    advanceMatchAfterGame.mockResolvedValueOnce({
      complete: true,
      match: { id: 'm1', status: 'COMPLETED', p1Wins: 1, p2Wins: 1, drawGames: 0, winnerId: null },
      nextSpawn: null,
    })

    const res = await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
      matchId: 'm1',
      matchSequence: 2,
      outcome: 'PLAYER2_WIN',
    })

    expect(res.status).toBe(201)
    expect(res.body.match).toMatchObject({
      id:       'm1',
      status:   'COMPLETED',
      complete: true,
      winnerId: null,
      nextGame: null,
    })
    expect(rematchRankedTableInPlace).not.toHaveBeenCalled()
    expect(updateBothElosAfterPvBot).not.toHaveBeenCalled()
    // A2.6 — match-score ELO fires once on completion with the aggregated W/D/L
    expect(updateBothElosAfterMatch).toHaveBeenCalledWith({
      player1Id: 'usr_1',
      player2Id: 'bot_1',
      p1Wins:    1,
      p2Wins:    1,
      drawGames: 0,
      isP2Bot:   true,
    })
  })

  it('on game 1 of a still-in-progress match: NO match-level ELO fires yet', async () => {
    advanceMatchAfterGame.mockResolvedValueOnce({
      complete: false,
      match: { id: 'm1', status: 'IN_PROGRESS', p1Wins: 1, p2Wins: 0, drawGames: 0, winnerId: null },
      nextSpawn: { sequence: 2, firstMoverId: 'bot_1', secondMoverId: 'usr_1', p1IsFirstMover: false },
    })
    rematchRankedTableInPlace.mockResolvedValueOnce({
      table: { id: 'tbl1' },
      previewState: { board: Array(9).fill(null), currentTurn: 'X' },
      humanMark: 'O', botMark: 'X',
    })
    await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
      matchId: 'm1',
      matchSequence: 1,
    })
    expect(updateBothElosAfterMatch).not.toHaveBeenCalled()
  })

  it('on advanceMatchAfterGame failure: still 201, no match payload, no rematch attempt', async () => {
    advanceMatchAfterGame.mockRejectedValueOnce(new Error('boom'))
    const res = await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
      matchId: 'm1',
      matchSequence: 1,
    })
    expect(res.status).toBe(201)
    expect(res.body.match).toBeUndefined()
    expect(rematchRankedTableInPlace).not.toHaveBeenCalled()
  })

  it('casual HVB games still run the per-game ELO update (no matchId)', async () => {
    await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
    })
    expect(advanceMatchAfterGame).not.toHaveBeenCalled()
    expect(updateBothElosAfterPvBot).toHaveBeenCalledWith('usr_1', 'bot_1', 'PLAYER1_WIN')
  })

  it('A2.7: emits match.gameComplete on a non-final game', async () => {
    advanceMatchAfterGame.mockResolvedValueOnce({
      complete: false,
      match: { id: 'm1', status: 'IN_PROGRESS', p1Wins: 1, p2Wins: 0, drawGames: 0, winnerId: null },
      nextSpawn: { sequence: 2, firstMoverId: 'bot_1', secondMoverId: 'usr_1', p1IsFirstMover: false },
    })
    rematchRankedTableInPlace.mockResolvedValueOnce({
      table: { id: 'tbl_match_1' },
      previewState: { board: Array(9).fill(null), currentTurn: 'X' },
      humanMark: 'O', botMark: 'X',
    })
    await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
      matchId: 'm1',
      matchSequence: 1,
      outcome: 'PLAYER1_WIN',
    })
    expect(appendToStream).toHaveBeenCalledWith(
      'table:tbl_match_1:state',
      expect.objectContaining({
        kind:         'match.gameComplete',
        matchId:      'm1',
        sequence:     1,
        gameWinnerId: 'usr_1',
        complete:     false,
        nextSequence: 2,
      }),
      expect.objectContaining({ userId: '*' }),
    )
  })

  it('A2.7: emits match.completed on the final game', async () => {
    advanceMatchAfterGame.mockResolvedValueOnce({
      complete: true,
      match: { id: 'm1', status: 'COMPLETED', p1Wins: 2, p2Wins: 0, drawGames: 0, winnerId: 'usr_1' },
      nextSpawn: null,
    })
    await request(app).post('/api/v1/games').send({
      ...BASE_BODY,
      mode: 'HVB',
      botModelId: 'builtin:minimax:novice',
      matchId: 'm1',
      matchSequence: 2,
      outcome: 'PLAYER1_WIN',
    })
    const kinds = appendToStream.mock.calls.map(c => c[1]?.kind)
    expect(kinds).toEqual(expect.arrayContaining(['match.gameComplete', 'match.completed']))
    const completedCall = appendToStream.mock.calls.find(c => c[1]?.kind === 'match.completed')
    expect(completedCall[1]).toMatchObject({
      matchId:  'm1',
      winnerId: 'usr_1',
      p1Wins:   2,
      p2Wins:   0,
      status:   'COMPLETED',
    })
  })
})
