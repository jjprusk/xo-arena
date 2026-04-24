import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_user_1' }
    next()
  },
}))

const mockUser = {
  id: 'user_1',
  preferences: {},
}

vi.mock('../../lib/db.js', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update:     vi.fn(),
    },
  },
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

vi.mock('../../services/journeyService.js', () => ({
  restartJourney: vi.fn().mockResolvedValue(undefined),
}))

import db from '../../lib/db.js'
import guideRouter from '../guide.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/', guideRouter)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  db.user.findUnique.mockResolvedValue({ ...mockUser, preferences: {} })
  db.user.update.mockResolvedValue(mockUser)
})

// ── GET /preferences ──────────────────────────────────────────────────────────

describe('GET /preferences', () => {
  it('returns default prefs when preferences is empty (no auto-step in v1)', async () => {
    // Intelligent Guide v1: GET /preferences never auto-completes a step.
    // Step 1 is "Play a PvAI game" — server-detected in games.js / socketHandler.js,
    // not on preferences hydration.
    const res = await request(buildApp()).get('/preferences')
    expect(res.status).toBe(200)
    expect(res.body.guideSlots).toEqual([])
    expect(res.body.guideNotificationPrefs).toEqual({})
    expect(res.body.journeyProgress.completedSteps).toEqual([])
    expect(res.body.journeyProgress.dismissedAt).toBeNull()
  })

  it('returns stored guideSlots when present', async () => {
    const slots = [{ key: 'play', label: 'Play' }]
    db.user.findUnique.mockResolvedValue({ ...mockUser, preferences: { guideSlots: slots } })
    const res = await request(buildApp()).get('/preferences')
    expect(res.status).toBe(200)
    expect(res.body.guideSlots).toEqual(slots)
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(buildApp()).get('/preferences')
    expect(res.status).toBe(404)
  })
})

// ── PATCH /preferences ────────────────────────────────────────────────────────

describe('PATCH /preferences', () => {
  it('persists guideSlots', async () => {
    const slots = [{ key: 'play', label: 'Play' }]
    const res = await request(buildApp()).patch('/preferences').send({ guideSlots: slots })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ preferences: expect.objectContaining({ guideSlots: slots }) }),
      })
    )
  })

  it('rejects guideSlots with more than 8 items', async () => {
    const slots = Array.from({ length: 9 }, (_, i) => ({ key: `s${i}` }))
    const res = await request(buildApp()).patch('/preferences').send({ guideSlots: slots })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/8/)
  })

  it('rejects guideSlots that is not an array', async () => {
    const res = await request(buildApp()).patch('/preferences').send({ guideSlots: 'bad' })
    expect(res.status).toBe(400)
  })

  it('accepts exactly 8 slots', async () => {
    const slots = Array.from({ length: 8 }, (_, i) => ({ key: `s${i}` }))
    const res = await request(buildApp()).patch('/preferences').send({ guideSlots: slots })
    expect(res.status).toBe(200)
  })

  it('merges with existing preferences — does not overwrite unrelated keys', async () => {
    db.user.findUnique.mockResolvedValue({
      ...mockUser,
      preferences: { someOtherPref: true, guideSlots: [] },
    })
    const res = await request(buildApp()).patch('/preferences').send({ guideSlots: [{ key: 'play' }] })
    expect(res.status).toBe(200)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          preferences: expect.objectContaining({ someOtherPref: true }),
        }),
      })
    )
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(buildApp()).patch('/preferences').send({ guideSlots: [] })
    expect(res.status).toBe(404)
  })

  it('persists journeyProgress', async () => {
    const jp = { completedSteps: [1, 2], dismissedAt: null }
    const res = await request(buildApp()).patch('/preferences').send({ journeyProgress: jp })
    expect(res.status).toBe(200)
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ preferences: expect.objectContaining({ journeyProgress: jp }) }),
      })
    )
  })
})

// ── POST /journey/step REMOVED in Intelligent Guide v1 ────────────────────────
// All 7 steps are now server-detected at their trigger events.

describe('POST /journey/step (removed in v1)', () => {
  it('returns 404 — endpoint no longer exists', async () => {
    const res = await request(buildApp()).post('/journey/step').send({ step: 2 })
    expect(res.status).toBe(404)
  })
})
