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
const dbEntry = {
  create:     vi.fn(),
  update:     vi.fn(),
  delete:     vi.fn(),
  findUnique: vi.fn(),
  findMany:   vi.fn(),
}
const dbHelpDoc   = { deleteMany: vi.fn() }
const dbHelpChunk = { deleteMany: vi.fn() }
const dbUser = { findUnique: vi.fn(), update: vi.fn() }
vi.mock('../../lib/db.js', () => ({
  default: {
    trainingSession:     dbTrainingSession,
    trainingSessionNote: dbNote,
    researchLogEntry:    dbEntry,
    helpDoc:             dbHelpDoc,
    helpChunk:           dbHelpChunk,
    user:                dbUser,
  },
}))

// Mock the publish service at the route boundary so route tests stay tightly
// scoped to status codes + payload shape. The service has its own dedicated
// test file at src/services/research/__tests__/publishService.test.js.
const publishMock = {
  publishNote:     vi.fn(),
  unpublishNote:   vi.fn(),
  publishEntry:   vi.fn(),
  unpublishEntry: vi.fn(),
}

class TestPublishError extends Error {
  constructor(code, status, message) {
    super(message ?? code)
    this.code = code
    this.status = status
  }
}

const communityMock = {
  listCommunityDocs:    vi.fn(),
  buildExportMarkdown:  vi.fn(),
}
vi.mock('../../services/research/communityService.js', () => ({
  listCommunityDocs:    (...a) => communityMock.listCommunityDocs(...a),
  buildExportMarkdown:  (...a) => communityMock.buildExportMarkdown(...a),
}))

vi.mock('../../services/research/publishService.js', () => ({
  publishNote:     (...a) => publishMock.publishNote(...a),
  unpublishNote:   (...a) => publishMock.unpublishNote(...a),
  publishEntry:    (...a) => publishMock.publishEntry(...a),
  unpublishEntry:  (...a) => publishMock.unpublishEntry(...a),
  PublishError:    TestPublishError,
}))

const { _resetResearchPublishRateLimitState } = await import(
  '../../middleware/researchPublishRateLimit.js'
)
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
  _resetResearchPublishRateLimitState()
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

// ── Publish / unpublish routes (Sprint 2 §2.2) ────────────────────────────

describe('POST /research/notes/:noteId/publish', () => {
  it('returns 200 + service payload on success', async () => {
    publishMock.publishNote.mockResolvedValue({
      note: { id: 'note_1', sharedWithCommunity: true, helpDocId: 'doc_1' },
      helpDocId: 'doc_1',
      scrubMatches: [{ kind: 'email', original: 'x@y.z', offset: 5 }],
    })
    const res = await request(makeApp()).post('/api/v1/research/notes/note_1/publish')
    expect(res.status).toBe(200)
    expect(res.body.helpDocId).toBe('doc_1')
    expect(res.body.scrubMatches).toHaveLength(1)
    expect(publishMock.publishNote).toHaveBeenCalledWith('note_1', AUTHED_USER_ID)
  })

  it('maps PublishError(publish_disabled) → 503', async () => {
    publishMock.publishNote.mockRejectedValue(
      new TestPublishError('publish_disabled', 503, 'flag off'),
    )
    const res = await request(makeApp()).post('/api/v1/research/notes/note_1/publish')
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('publish_disabled')
  })

  it('maps PublishError(note_not_found) → 404', async () => {
    publishMock.publishNote.mockRejectedValue(
      new TestPublishError('note_not_found', 404),
    )
    const res = await request(makeApp()).post('/api/v1/research/notes/missing/publish')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('note_not_found')
  })

  it('maps PublishError(forbidden) → 403', async () => {
    publishMock.publishNote.mockRejectedValue(
      new TestPublishError('forbidden', 403),
    )
    const res = await request(makeApp()).post('/api/v1/research/notes/note_1/publish')
    expect(res.status).toBe(403)
  })

  it('maps unexpected errors → 500', async () => {
    publishMock.publishNote.mockRejectedValue(new Error('db down'))
    const res = await request(makeApp()).post('/api/v1/research/notes/note_1/publish')
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('internal_error')
  })

  it('rejects unauthenticated callers (401)', async () => {
    isGuest = true
    const res = await request(makeApp()).post('/api/v1/research/notes/note_1/publish')
    expect(res.status).toBe(401)
    expect(publishMock.publishNote).not.toHaveBeenCalled()
  })
})

describe('POST /research/notes/:noteId/unpublish', () => {
  it('returns 200 + updated note', async () => {
    publishMock.unpublishNote.mockResolvedValue({
      note: { id: 'note_1', sharedWithCommunity: false, helpDocId: null },
    })
    const res = await request(makeApp()).post('/api/v1/research/notes/note_1/unpublish')
    expect(res.status).toBe(200)
    expect(res.body.note.sharedWithCommunity).toBe(false)
  })

  it('maps PublishError(publish_disabled) → 503', async () => {
    publishMock.unpublishNote.mockRejectedValue(
      new TestPublishError('publish_disabled', 503),
    )
    const res = await request(makeApp()).post('/api/v1/research/notes/note_1/unpublish')
    expect(res.status).toBe(503)
  })
})

// ── ResearchLogEntry CRUD ─────────────────────────────────────────────────

describe('POST /research/entries', () => {
  it('creates an entry (201) and stamps userId from auth', async () => {
    dbEntry.create.mockResolvedValue({
      id: 'e1', userId: AUTHED_USER_ID,
      title: 'Q-learning plateau',
      body: 'plateau after 20k episodes',
      category: 'RETROSPECTIVE',
      tags: ['q_learning'],
    })
    const res = await request(makeApp())
      .post('/api/v1/research/entries')
      .send({
        title: 'Q-learning plateau',
        body:  'plateau after 20k episodes',
        category: 'RETROSPECTIVE',
        tags: ['q-learning'],
      })
    expect(res.status).toBe(201)
    expect(res.body.entry.id).toBe('e1')
    const createArg = dbEntry.create.mock.calls[0][0].data
    expect(createArg.userId).toBe(AUTHED_USER_ID)
    expect(createArg.category).toBe('RETROSPECTIVE')
    expect(createArg.tags).toEqual(['q_learning']) // normalized
  })

  it('rejects an unknown category (400)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/research/entries')
      .send({ title: 't', body: 'b', category: 'BAD' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_body')
  })

  it('rejects a missing title (400)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/research/entries')
      .send({ body: 'b', category: 'PLANNING' })
    expect(res.status).toBe(400)
  })

  it('rejects a body > 4 KB (400)', async () => {
    const body = 'x'.repeat(4 * 1024 + 1)
    const res = await request(makeApp())
      .post('/api/v1/research/entries')
      .send({ title: 't', body, category: 'OTHER' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('body_too_large')
  })

  it('rejects a title > 120 chars (400)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/research/entries')
      .send({ title: 'x'.repeat(121), body: 'b', category: 'OTHER' })
    expect(res.status).toBe(400)
  })

  it('rejects unauthenticated callers (401)', async () => {
    isGuest = true
    const res = await request(makeApp())
      .post('/api/v1/research/entries')
      .send({ title: 't', body: 'b', category: 'OTHER' })
    expect(res.status).toBe(401)
  })
})

describe('PATCH /research/entries/:entryId', () => {
  it('updates the owner\'s entry (200)', async () => {
    dbEntry.findUnique.mockResolvedValue({ id: 'e1', userId: AUTHED_USER_ID })
    dbEntry.update.mockResolvedValue({ id: 'e1', body: 'updated' })
    const res = await request(makeApp())
      .patch('/api/v1/research/entries/e1')
      .send({ body: 'updated' })
    expect(res.status).toBe(200)
    expect(res.body.entry.body).toBe('updated')
  })

  it('returns 404 for a missing entry', async () => {
    dbEntry.findUnique.mockResolvedValue(null)
    const res = await request(makeApp())
      .patch('/api/v1/research/entries/missing')
      .send({ body: 'x' })
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not the owner', async () => {
    dbEntry.findUnique.mockResolvedValue({ id: 'e1', userId: OTHER_USER_ID })
    const res = await request(makeApp())
      .patch('/api/v1/research/entries/e1')
      .send({ body: 'updated' })
    expect(res.status).toBe(403)
    expect(dbEntry.update).not.toHaveBeenCalled()
  })

  it('returns 400 when no fields are provided', async () => {
    const res = await request(makeApp())
      .patch('/api/v1/research/entries/e1')
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('DELETE /research/entries/:entryId', () => {
  it('deletes the owner\'s entry (200)', async () => {
    dbEntry.findUnique.mockResolvedValue({
      id: 'e1', userId: AUTHED_USER_ID, helpDocId: null,
    })
    dbEntry.delete.mockResolvedValue({})
    const res = await request(makeApp())
      .delete('/api/v1/research/entries/e1')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(dbHelpDoc.deleteMany).not.toHaveBeenCalled()
  })

  it('tears down linked HelpDoc + chunks when entry was published', async () => {
    dbEntry.findUnique.mockResolvedValue({
      id: 'e1', userId: AUTHED_USER_ID, helpDocId: 'doc_x',
    })
    dbEntry.delete.mockResolvedValue({})
    const res = await request(makeApp())
      .delete('/api/v1/research/entries/e1')
    expect(res.status).toBe(200)
    expect(dbHelpChunk.deleteMany).toHaveBeenCalledWith({ where: { docId: 'doc_x' } })
    expect(dbHelpDoc.deleteMany).toHaveBeenCalledWith({ where: { id: 'doc_x' } })
    expect(dbEntry.delete).toHaveBeenCalledWith({ where: { id: 'e1' } })
  })

  it('returns 403 when caller is not the owner', async () => {
    dbEntry.findUnique.mockResolvedValue({ id: 'e1', userId: OTHER_USER_ID })
    const res = await request(makeApp())
      .delete('/api/v1/research/entries/e1')
    expect(res.status).toBe(403)
    expect(dbEntry.delete).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing entry', async () => {
    dbEntry.findUnique.mockResolvedValue(null)
    const res = await request(makeApp())
      .delete('/api/v1/research/entries/missing')
    expect(res.status).toBe(404)
  })
})

describe('GET /research/entries', () => {
  it('lists own entries (200)', async () => {
    dbEntry.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }])
    const res = await request(makeApp()).get('/api/v1/research/entries')
    expect(res.status).toBe(200)
    expect(res.body.entries).toHaveLength(2)
    expect(dbEntry.findMany.mock.calls[0][0].where.userId).toBe(AUTHED_USER_ID)
  })

  it('applies category + tag + since filters', async () => {
    dbEntry.findMany.mockResolvedValue([])
    const res = await request(makeApp())
      .get('/api/v1/research/entries')
      .query({ category: 'PLANNING', tag: 'q-learning', since: '2026-05-01T00:00:00Z' })
    expect(res.status).toBe(200)
    const where = dbEntry.findMany.mock.calls[0][0].where
    expect(where.category).toBe('PLANNING')
    expect(where.tags).toEqual({ has: 'q_learning' })
    expect(where.createdAt.gte).toBeInstanceOf(Date)
  })

  it('rejects an invalid category in the query (400)', async () => {
    const res = await request(makeApp())
      .get('/api/v1/research/entries')
      .query({ category: 'BAD' })
    expect(res.status).toBe(400)
  })
})

describe('GET /research/entries/:entryId', () => {
  it('returns the entry when caller owns it', async () => {
    dbEntry.findUnique.mockResolvedValue({
      id: 'e1', userId: AUTHED_USER_ID, sharedWithCommunity: false,
    })
    const res = await request(makeApp()).get('/api/v1/research/entries/e1')
    expect(res.status).toBe(200)
    expect(res.body.entry.id).toBe('e1')
  })

  it('allows reading a community-shared entry owned by another user', async () => {
    dbEntry.findUnique.mockResolvedValue({
      id: 'e1', userId: OTHER_USER_ID, sharedWithCommunity: true,
    })
    const res = await request(makeApp()).get('/api/v1/research/entries/e1')
    expect(res.status).toBe(200)
  })

  it('blocks reading another user\'s private entry (403)', async () => {
    dbEntry.findUnique.mockResolvedValue({
      id: 'e1', userId: OTHER_USER_ID, sharedWithCommunity: false,
    })
    const res = await request(makeApp()).get('/api/v1/research/entries/e1')
    expect(res.status).toBe(403)
  })

  it('returns 404 for a missing entry', async () => {
    dbEntry.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).get('/api/v1/research/entries/missing')
    expect(res.status).toBe(404)
  })
})

describe('POST /research/entries/:entryId/publish', () => {
  it('returns 200 + helpDocId on success', async () => {
    publishMock.publishEntry.mockResolvedValue({
      entry: { id: 'e1', sharedWithCommunity: true, helpDocId: 'doc_1' },
      helpDocId: 'doc_1',
      scrubMatches: [],
    })
    const res = await request(makeApp()).post('/api/v1/research/entries/e1/publish')
    expect(res.status).toBe(200)
    expect(res.body.helpDocId).toBe('doc_1')
    expect(publishMock.publishEntry).toHaveBeenCalledWith('e1', AUTHED_USER_ID)
  })

  it('maps PublishError(entry_not_found) → 404', async () => {
    publishMock.publishEntry.mockRejectedValue(
      new TestPublishError('entry_not_found', 404),
    )
    const res = await request(makeApp()).post('/api/v1/research/entries/missing/publish')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('entry_not_found')
  })
})

describe('POST /research/entries/:entryId/unpublish', () => {
  it('returns 200 + updated entry', async () => {
    publishMock.unpublishEntry.mockResolvedValue({
      entry: { id: 'e1', sharedWithCommunity: false, helpDocId: null },
    })
    const res = await request(makeApp()).post('/api/v1/research/entries/e1/unpublish')
    expect(res.status).toBe(200)
    expect(res.body.entry.helpDocId).toBeNull()
  })
})

// ── Community feed + export ───────────────────────────────────────────────

describe('GET /research/community', () => {
  it('returns the community feed (200)', async () => {
    communityMock.listCommunityDocs.mockResolvedValue({
      items: [{ id: 'd1', title: 't' }],
      nextCursor: null,
    })
    const res = await request(makeApp()).get('/api/v1/research/community')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(communityMock.listCommunityDocs)
      .toHaveBeenCalledWith(expect.objectContaining({}))
  })

  it('passes tag, limit, and cursor through to the service', async () => {
    communityMock.listCommunityDocs.mockResolvedValue({ items: [], nextCursor: null })
    const res = await request(makeApp())
      .get('/api/v1/research/community')
      .query({
        tag: 'q-learning', limit: '10',
        cursorCreatedAt: '2026-05-10T00:00:00Z', cursorId: 'd5',
      })
    expect(res.status).toBe(200)
    const arg = communityMock.listCommunityDocs.mock.calls[0][0]
    expect(arg.tag).toBe('q-learning')
    expect(arg.limit).toBe(10)
    expect(arg.cursorId).toBe('d5')
  })

  it('rejects when cursorCreatedAt is provided without cursorId (400)', async () => {
    const res = await request(makeApp())
      .get('/api/v1/research/community')
      .query({ cursorCreatedAt: '2026-05-10T00:00:00Z' })
    expect(res.status).toBe(400)
  })

  it('returns 500 when the service throws', async () => {
    communityMock.listCommunityDocs.mockRejectedValue(new Error('db down'))
    const res = await request(makeApp()).get('/api/v1/research/community')
    expect(res.status).toBe(500)
  })

  it('rejects unauthenticated callers (401)', async () => {
    isGuest = true
    const res = await request(makeApp()).get('/api/v1/research/community')
    expect(res.status).toBe(401)
  })
})

describe('research publish rate limit (route integration)', () => {
  it('returns 429 once the per-week cap is reached on /notes/:id/publish', async () => {
    publishMock.publishNote.mockResolvedValue({
      note: { id: 'note_1' }, helpDocId: 'd1', scrubMatches: [],
    })
    const app = makeApp()
    // Hit the cap (50). The 51st call should 429 before reaching publishNote.
    for (let i = 0; i < 50; i++) {
      const r = await request(app).post('/api/v1/research/notes/note_1/publish')
      expect(r.status).toBe(200)
    }
    const r = await request(app).post('/api/v1/research/notes/note_1/publish')
    expect(r.status).toBe(429)
    expect(r.body.error).toBe('rate_limited')
    expect(r.body.scope).toBe('week')
  })

  it('does NOT apply to /unpublish', async () => {
    publishMock.publishNote.mockResolvedValue({
      note: {}, helpDocId: 'd1', scrubMatches: [],
    })
    publishMock.unpublishNote.mockResolvedValue({ note: {} })
    const app = makeApp()
    for (let i = 0; i < 50; i++) {
      await request(app).post('/api/v1/research/notes/note_1/publish')
    }
    const r = await request(app).post('/api/v1/research/notes/note_1/unpublish')
    expect(r.status).toBe(200) // unpublish always allowed
  })
})

describe('GET /research/export.md', () => {
  it('returns text/markdown with the export body', async () => {
    communityMock.buildExportMarkdown.mockResolvedValue('# Research Journal Export\n\nbody')
    const res = await request(makeApp()).get('/api/v1/research/export.md')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/markdown/)
    expect(res.headers['content-disposition']).toContain('training-journal.md')
    expect(res.text).toContain('# Research Journal Export')
    expect(communityMock.buildExportMarkdown).toHaveBeenCalledWith(AUTHED_USER_ID)
  })

  it('rejects unauthenticated callers (401)', async () => {
    isGuest = true
    const res = await request(makeApp()).get('/api/v1/research/export.md')
    expect(res.status).toBe(401)
  })
})

// ── shareNotesWithGuide preference (Sprint 2 §2.4) ────────────────────────

describe('GET /research/preferences', () => {
  it('returns shareNotesWithGuide=false when the key is absent', async () => {
    dbUser.findUnique.mockResolvedValue({ preferences: {} })
    const res = await request(makeApp()).get('/api/v1/research/preferences')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ shareNotesWithGuide: false })
  })

  it('returns the stored boolean when present', async () => {
    dbUser.findUnique.mockResolvedValue({ preferences: { shareNotesWithGuide: true } })
    const res = await request(makeApp()).get('/api/v1/research/preferences')
    expect(res.status).toBe(200)
    expect(res.body.shareNotesWithGuide).toBe(true)
  })

  it('handles a null preferences blob gracefully', async () => {
    dbUser.findUnique.mockResolvedValue({ preferences: null })
    const res = await request(makeApp()).get('/api/v1/research/preferences')
    expect(res.status).toBe(200)
    expect(res.body.shareNotesWithGuide).toBe(false)
  })

  it('returns 404 when the user record is missing', async () => {
    dbUser.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).get('/api/v1/research/preferences')
    expect(res.status).toBe(404)
  })
})

describe('PATCH /research/preferences', () => {
  it('flips the key from false → true and preserves other prefs', async () => {
    dbUser.findUnique.mockResolvedValue({
      preferences: { emailAchievements: true, shareNotesWithGuide: false },
    })
    dbUser.update.mockResolvedValue({})
    const res = await request(makeApp())
      .patch('/api/v1/research/preferences')
      .send({ shareNotesWithGuide: true })
    expect(res.status).toBe(200)
    expect(res.body.shareNotesWithGuide).toBe(true)
    const data = dbUser.update.mock.calls[0][0].data
    expect(data.preferences).toEqual({
      emailAchievements:   true,
      shareNotesWithGuide: true,
    })
  })

  it('seeds the key when the blob was previously empty', async () => {
    dbUser.findUnique.mockResolvedValue({ preferences: {} })
    dbUser.update.mockResolvedValue({})
    const res = await request(makeApp())
      .patch('/api/v1/research/preferences')
      .send({ shareNotesWithGuide: true })
    expect(res.status).toBe(200)
    expect(dbUser.update.mock.calls[0][0].data.preferences)
      .toEqual({ shareNotesWithGuide: true })
  })

  it('rejects non-boolean values (400)', async () => {
    const res = await request(makeApp())
      .patch('/api/v1/research/preferences')
      .send({ shareNotesWithGuide: 'yes' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_body')
    expect(dbUser.update).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers (401)', async () => {
    isGuest = true
    const res = await request(makeApp())
      .patch('/api/v1/research/preferences')
      .send({ shareNotesWithGuide: true })
    expect(res.status).toBe(401)
  })
})
