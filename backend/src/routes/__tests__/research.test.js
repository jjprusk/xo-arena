/**
 * Tests for /api/v1/research (Sprint 1 — TrainingSessionNote CRUD).
 *
 * Auth + db are mocked; the goal is to lock the route contract (validation,
 * owner checks, status codes) before Sprint 2 layers publish flows on top.
 *
 * See doc/Research_Log_Plan.md §3 "Sprint 1".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const AUTHED_USER_ID = 'user_owner'
const OTHER_USER_ID  = 'user_intruder'

let isGuest = false
let currentUserId = AUTHED_USER_ID

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (isGuest) return res.status(401).json({ error: 'Authentication required' })
    req.auth = { userId: currentUserId }
    next()
  },
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const dbTrainingSession = {
  findUnique: vi.fn(),
}
const dbNote = {
  create:     vi.fn(),
  update:     vi.fn(),
  delete:     vi.fn(),
  findUnique: vi.fn(),
  findMany:   vi.fn(),
}
vi.mock('../../lib/db.js', () => ({
  default: {
    trainingSession:     dbTrainingSession,
    trainingSessionNote: dbNote,
  },
}))

const researchRouter = (await import('../research.js')).default

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/research', researchRouter)
  return app
}

beforeEach(() => {
  isGuest = false
  currentUserId = AUTHED_USER_ID
  vi.clearAllMocks()
})

describe('POST /research/sessions/:sessionId/notes', () => {
  it('creates a note on the user\'s own session (201)', async () => {
    dbTrainingSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      model: { createdBy: AUTHED_USER_ID },
    })
    dbNote.create.mockResolvedValue({
      id: 'note_1',
      userId: AUTHED_USER_ID,
      sessionId: 'sess_1',
      body: 'lr=3e-4 felt right',
      outcome: 'SUCCESS',
      tags: ['lr', 'q_learning'],
    })

    const res = await request(makeApp())
      .post('/api/v1/research/sessions/sess_1/notes')
      .send({ body: 'lr=3e-4 felt right', outcome: 'SUCCESS', tags: ['LR', 'q_learning', 'LR'] })

    expect(res.status).toBe(201)
    expect(res.body.note.id).toBe('note_1')
    // Verify tag normalization happened before the DB call (lower + dedup).
    expect(dbNote.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId:    AUTHED_USER_ID,
        sessionId: 'sess_1',
        tags:      ['lr', 'q_learning'],
        outcome:   'SUCCESS',
      }),
    }))
  })

  it('rejects creates on another user\'s session (403)', async () => {
    dbTrainingSession.findUnique.mockResolvedValue({
      id: 'sess_1',
      model: { createdBy: OTHER_USER_ID },
    })
    const res = await request(makeApp())
      .post('/api/v1/research/sessions/sess_1/notes')
      .send({ body: 'cross-user attempt', outcome: 'SUCCESS' })
    expect(res.status).toBe(403)
    expect(dbNote.create).not.toHaveBeenCalled()
  })

  it('returns 404 when the session does not exist', async () => {
    dbTrainingSession.findUnique.mockResolvedValue(null)
    const res = await request(makeApp())
      .post('/api/v1/research/sessions/missing/notes')
      .send({ body: 'orphan', outcome: 'SUCCESS' })
    expect(res.status).toBe(404)
    expect(dbNote.create).not.toHaveBeenCalled()
  })

  it('rejects invalid outcome (400)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/research/sessions/sess_1/notes')
      .send({ body: 'x', outcome: 'NOT_A_REAL_OUTCOME' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_body')
  })

  it('rejects oversized body (400 body_too_large)', async () => {
    const huge = 'x'.repeat(2 * 1024 + 1)
    dbTrainingSession.findUnique.mockResolvedValue({
      id: 'sess_1', model: { createdBy: AUTHED_USER_ID },
    })
    const res = await request(makeApp())
      .post('/api/v1/research/sessions/sess_1/notes')
      .send({ body: huge, outcome: 'SUCCESS' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('body_too_large')
  })

  it('returns 401 for unauthenticated callers', async () => {
    isGuest = true
    const res = await request(makeApp())
      .post('/api/v1/research/sessions/sess_1/notes')
      .send({ body: 'x', outcome: 'SUCCESS' })
    expect(res.status).toBe(401)
  })
})

describe('PATCH /research/notes/:noteId', () => {
  it('updates the owner\'s own note', async () => {
    dbNote.findUnique.mockResolvedValue({ id: 'note_1', userId: AUTHED_USER_ID })
    dbNote.update.mockResolvedValue({ id: 'note_1', body: 'updated', outcome: 'PLATEAU' })

    const res = await request(makeApp())
      .patch('/api/v1/research/notes/note_1')
      .send({ body: 'updated', outcome: 'PLATEAU' })

    expect(res.status).toBe(200)
    expect(res.body.note.body).toBe('updated')
    expect(dbNote.update).toHaveBeenCalledWith({
      where: { id: 'note_1' },
      data:  { body: 'updated', outcome: 'PLATEAU' },
    })
  })

  it('blocks cross-user edits (403)', async () => {
    dbNote.findUnique.mockResolvedValue({ id: 'note_1', userId: OTHER_USER_ID })
    const res = await request(makeApp())
      .patch('/api/v1/research/notes/note_1')
      .send({ body: 'hijack' })
    expect(res.status).toBe(403)
    expect(dbNote.update).not.toHaveBeenCalled()
  })
})

describe('DELETE /research/notes/:noteId', () => {
  it('deletes the owner\'s own note', async () => {
    dbNote.findUnique.mockResolvedValue({ id: 'note_1', userId: AUTHED_USER_ID })
    dbNote.delete.mockResolvedValue({ id: 'note_1' })
    const res = await request(makeApp()).delete('/api/v1/research/notes/note_1')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(dbNote.delete).toHaveBeenCalledWith({ where: { id: 'note_1' } })
  })

  it('returns 404 when the note does not exist', async () => {
    dbNote.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).delete('/api/v1/research/notes/missing')
    expect(res.status).toBe(404)
  })
})

describe('GET /research/notes', () => {
  it('lists notes scoped to the caller, newest first', async () => {
    dbNote.findMany.mockResolvedValue([
      { id: 'n2', createdAt: new Date('2026-05-15') },
      { id: 'n1', createdAt: new Date('2026-05-10') },
    ])
    const res = await request(makeApp()).get('/api/v1/research/notes?outcome=SUCCESS&tag=lr&limit=25')
    expect(res.status).toBe(200)
    expect(res.body.notes).toHaveLength(2)
    expect(dbNote.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId:  AUTHED_USER_ID,
        outcome: 'SUCCESS',
        tags:    { has: 'lr' },
      }),
      orderBy: { createdAt: 'desc' },
      take:    25,
    }))
  })
})

describe('GET /research/notes/:noteId', () => {
  it('returns the note when caller owns it', async () => {
    dbNote.findUnique.mockResolvedValue({
      id: 'note_1', userId: AUTHED_USER_ID, sharedWithCommunity: false,
    })
    const res = await request(makeApp()).get('/api/v1/research/notes/note_1')
    expect(res.status).toBe(200)
    expect(res.body.note.id).toBe('note_1')
  })

  it('blocks reading another user\'s private note (403)', async () => {
    dbNote.findUnique.mockResolvedValue({
      id: 'note_1', userId: OTHER_USER_ID, sharedWithCommunity: false,
    })
    const res = await request(makeApp()).get('/api/v1/research/notes/note_1')
    expect(res.status).toBe(403)
  })
})
