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
}))

vi.mock('../../services/creditService.js', () => ({
  recordGameCompletion: vi.fn().mockResolvedValue([]),
}))

const gamesRouter = (await import('../games.js')).default
const { getUserByBetterAuthId, getBotByModelId, createGame } =
  await import('../../services/userService.js')
const { updatePlayerEloAfterPvAI, updateBothElosAfterPvBot } =
  await import('../../services/eloService.js')
const { recordGameCompletion } = await import('../../services/creditService.js')

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

describe('POST /api/v1/games — PVAI (default)', () => {
  it('records a PVAI game and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, difficulty: 'easy', aiImplementationId: 'minimax' })

    expect(res.status).toBe(201)
    expect(res.body.game.id).toBe('game_1')
    expect(createGame).toHaveBeenCalledWith(expect.objectContaining({ mode: 'PVAI' }))
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

describe('POST /api/v1/games — PVBOT', () => {
  beforeEach(() => {
    getBotByModelId.mockResolvedValue(mockBot)
  })

  it('records a PVBOT game and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'builtin:minimax:novice' })

    expect(res.status).toBe(201)
    expect(createGame).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'PVBOT', player2Id: 'bot_1' })
    )
    expect(updateBothElosAfterPvBot).toHaveBeenCalledWith('usr_1', 'bot_1', 'PLAYER1_WIN')
  })

  it('sets human as winner on PLAYER1_WIN', async () => {
    await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'builtin:minimax:novice', outcome: 'PLAYER1_WIN' })

    const call = createGame.mock.calls[0][0]
    expect(call.winnerId).toBe('usr_1')
  })

  it('sets bot as winner on PLAYER2_WIN', async () => {
    await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'builtin:minimax:novice', outcome: 'PLAYER2_WIN' })

    const call = createGame.mock.calls[0][0]
    expect(call.winnerId).toBe('bot_1')
  })

  it('returns 400 when botModelId is missing', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT' })
    expect(res.status).toBe(400)
  })

  it('returns 404 when bot not found', async () => {
    getBotByModelId.mockResolvedValue(null)
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'unknown:bot' })
    expect(res.status).toBe(404)
  })

  it('returns 409 when bot is inactive', async () => {
    getBotByModelId.mockResolvedValue({ ...mockBot, botActive: false })
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'builtin:minimax:novice' })
    expect(res.status).toBe(409)
  })

  it('does not call PVAI ELO for PVBOT games', async () => {
    await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'builtin:minimax:novice' })
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

  it('calls recordGameCompletion fire-and-forget for PVBOT games', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'builtin:minimax:novice' })
    expect(res.status).toBe(201)
    // Allow the async fire-and-forget to settle
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(recordGameCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'xo-arena', mode: 'pvp' })
    )
    const call = recordGameCompletion.mock.calls[0][0]
    expect(call.participants).toContainEqual(expect.objectContaining({ userId: 'usr_1', isBot: false }))
    expect(call.participants).toContainEqual(expect.objectContaining({ userId: 'bot_1', isBot: true }))
  })

  it('does not call recordGameCompletion for PVAI games', async () => {
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
      .send({ ...BASE_BODY, mode: 'PVBOT', botModelId: 'builtin:minimax:novice' })
    expect(res.status).toBe(201)
  })
})
