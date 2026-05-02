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
  completeStep:   vi.fn().mockResolvedValue(true),
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

// ── POST /guest-credit (Phase 0) ──────────────────────────────────────────────

import { completeStep } from '../../services/journeyService.js'

describe('POST /guest-credit', () => {
  beforeEach(() => {
    db.user.findUnique.mockResolvedValue({ id: 'user_1' })
    completeStep.mockResolvedValue(true)
  })

  it('credits step 1 when hookStep1CompletedAt is provided', async () => {
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep1CompletedAt: '2026-04-24T10:00:00Z',
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.creditedSteps).toEqual([1])
    expect(completeStep).toHaveBeenCalledWith('user_1', 1)
  })

  it('credits both steps 1 and 2 when both timestamps are provided', async () => {
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep1CompletedAt: '2026-04-24T10:00:00Z',
      hookStep2CompletedAt: '2026-04-24T10:05:00Z',
    })

    expect(res.status).toBe(200)
    expect(res.body.creditedSteps).toEqual([1, 2])
  })

  it('credits only step 2 when only hookStep2CompletedAt is provided', async () => {
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep2CompletedAt: '2026-04-24T10:05:00Z',
    })

    expect(res.status).toBe(200)
    expect(res.body.creditedSteps).toEqual([2])
    expect(completeStep).toHaveBeenCalledWith('user_1', 2)
    expect(completeStep).not.toHaveBeenCalledWith('user_1', 1)
  })

  it('returns empty credited array when no timestamps are provided', async () => {
    const res = await request(buildApp()).post('/guest-credit').send({})

    expect(res.status).toBe(200)
    expect(res.body.creditedSteps).toEqual([])
    expect(completeStep).not.toHaveBeenCalled()
  })

  it('handles empty body (missing content-type, etc.) without crashing', async () => {
    const res = await request(buildApp()).post('/guest-credit')
    expect(res.status).toBe(200)
    expect(res.body.creditedSteps).toEqual([])
  })

  it('returns idempotent-safe result when completeStep reports already-done', async () => {
    completeStep.mockResolvedValue(false)  // Already completed
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep1CompletedAt: '2026-04-24T10:00:00Z',
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.creditedSteps).toEqual([])   // already-done does not appear in credited
  })

  it('returns 404 when user not found', async () => {
    db.user.findUnique.mockResolvedValue(null)
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep1CompletedAt: '2026-04-24T10:00:00Z',
    })
    expect(res.status).toBe(404)
  })

  // ── Edge cases (task #34) ────────────────────────────────────────────────
  // The guest-credit payload comes from client localStorage, which is
  // untrusted. The endpoint must handle malformed input, repeated calls,
  // and garbage values without crashing or double-paying the Hook reward.

  it('a second guest-credit call with same timestamps returns empty credited (idempotent)', async () => {
    // First call credits both — second call sees both already credited.
    completeStep
      .mockResolvedValueOnce(true)   // step 1 — first call
      .mockResolvedValueOnce(true)   // step 2 — first call
      .mockResolvedValueOnce(false)  // step 1 — second call (already done)
      .mockResolvedValueOnce(false)  // step 2 — second call (already done)

    const payload = {
      hookStep1CompletedAt: '2026-04-24T10:00:00Z',
      hookStep2CompletedAt: '2026-04-24T10:05:00Z',
    }

    const r1 = await request(buildApp()).post('/guest-credit').send(payload)
    const r2 = await request(buildApp()).post('/guest-credit').send(payload)

    expect(r1.body.creditedSteps).toEqual([1, 2])
    expect(r2.body.creditedSteps).toEqual([])    // both already done
    expect(r2.body.ok).toBe(true)                 // not an error
  })

  it('truthy-but-non-ISO timestamp still credits (route trusts client low — see route comment)', async () => {
    // The route's documented contract is best-effort — a truthy field is
    // enough to fire the credit. Validation lives client-side. The max
    // damage from a malicious client is +20 TC (one Hook reward), which
    // the doc deems acceptable. Pin the contract so a future "tighten
    // validation" change is a deliberate decision, not a silent break.
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep1CompletedAt: 'not-actually-an-iso-string',
    })
    expect(res.status).toBe(200)
    expect(res.body.creditedSteps).toEqual([1])
  })

  it('handles unexpected extra keys gracefully (forward-compatible payload)', async () => {
    // An older client might persist extra keys (e.g., a future
    // hookStep3CompletedAt). The route must ignore them, not 500.
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep1CompletedAt: '2026-04-24T10:00:00Z',
      hookStep3CompletedAt: '2026-04-24T11:00:00Z',  // not real
      garbageField:         { nested: 'object' },
    })
    expect(res.status).toBe(200)
    expect(res.body.creditedSteps).toEqual([1])
  })

  it('false-y timestamp values are skipped (null, "", 0, false)', async () => {
    const res = await request(buildApp()).post('/guest-credit').send({
      hookStep1CompletedAt: null,
      hookStep2CompletedAt: '',
    })
    expect(res.status).toBe(200)
    expect(res.body.creditedSteps).toEqual([])
    expect(completeStep).not.toHaveBeenCalled()
  })
})
