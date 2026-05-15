/**
 * Tests for /api/v1/admin/help/* routes. Auth + reindex are mocked. The
 * real DB happy-path is exercised in 1.11 acceptance.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => {
    req.auth = { userId: 'ba_helpadmin_1' }
    next()
  },
  requireHelpAdmin: (req, _res, next) => {
    req.auth = { userId: 'ba_helpadmin_1' }
    next()
  },
}))

const mockDb = {
  helpDoc: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  helpAnswer: {
    update:    vi.fn(),
    count:     vi.fn(),
    findMany:  vi.fn(),
  },
  helpQuery: {
    findMany:   vi.fn(),
    findUnique: vi.fn(),
    count:      vi.fn(),
  },
  helpChunk: {
    findMany: vi.fn(),
  },
  helpFeedback: {
    groupBy: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  $queryRaw: vi.fn(),
}
vi.mock('../../lib/db.js', () => ({ default: mockDb }))

const mockReindex = vi.fn()
const mockReindexAll = vi.fn()
vi.mock('../../services/help/corpusSeeder.js', () => ({
  reindexDoc: (...args) => mockReindex(...args),
  reindexAll: (...args) => mockReindexAll(...args),
  seedCorpus: vi.fn(),
}))

vi.mock('../../logger.js', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const helpAdminRouter = (await import('../helpAdmin.js')).default

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin/help', helpAdminRouter)
  return app
}

beforeEach(() => {
  Object.values(mockDb.helpDoc).forEach(fn => fn.mockReset())
  Object.values(mockDb.helpAnswer).forEach(fn => fn.mockReset())
  Object.values(mockDb.helpQuery).forEach(fn => fn.mockReset())
  Object.values(mockDb.helpChunk).forEach(fn => fn.mockReset())
  Object.values(mockDb.helpFeedback).forEach(fn => fn.mockReset())
  mockDb.user.findUnique.mockReset()
  mockDb.$queryRaw.mockReset()
  mockReindex.mockReset()
  mockReindexAll.mockReset()
})

describe('GET /api/v1/admin/help/docs', () => {
  it('returns paginated list with total', async () => {
    mockDb.helpDoc.findMany.mockResolvedValue([{ id: 'd1', slug: 's', title: 't', category: 'c' }])
    mockDb.helpDoc.count.mockResolvedValue(1)

    const res = await request(makeApp()).get('/api/v1/admin/help/docs')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(1)
    expect(res.body.docs).toHaveLength(1)
  })

  it('passes status filter to where clause', async () => {
    mockDb.helpDoc.findMany.mockResolvedValue([])
    mockDb.helpDoc.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/docs?status=DRAFT')
    expect(mockDb.helpDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'DRAFT' }) })
    )
  })

  it('ignores invalid status', async () => {
    mockDb.helpDoc.findMany.mockResolvedValue([])
    mockDb.helpDoc.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/docs?status=BOGUS')
    expect(mockDb.helpDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    )
  })

  it('caps limit at 200', async () => {
    mockDb.helpDoc.findMany.mockResolvedValue([])
    mockDb.helpDoc.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/docs?limit=9999')
    expect(mockDb.helpDoc.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 })
    )
  })
})

describe('GET /api/v1/admin/help/docs/:id', () => {
  it('returns 404 when not found', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).get('/api/v1/admin/help/docs/missing')
    expect(res.status).toBe(404)
  })

  it('returns the full doc when found', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue({
      id: 'd1', slug: 's', title: 't', body: 'B', category: 'c', version: 3,
    })
    const res = await request(makeApp()).get('/api/v1/admin/help/docs/d1')
    expect(res.status).toBe(200)
    expect(res.body.doc.version).toBe(3)
    expect(res.body.doc.body).toBe('B')
  })
})

describe('POST /api/v1/admin/help/docs', () => {
  it('400 when required fields missing', async () => {
    const res = await request(makeApp())
      .post('/api/v1/admin/help/docs')
      .send({ slug: 'x' })
    expect(res.status).toBe(400)
  })

  it('400 on invalid status', async () => {
    const res = await request(makeApp())
      .post('/api/v1/admin/help/docs')
      .send({ slug: 's', title: 't', body: 'B', category: 'c', status: 'WHATEVER' })
    expect(res.status).toBe(400)
  })

  it('creates and reindexes on happy path', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    mockDb.helpDoc.create.mockResolvedValue({ id: 'd1', slug: 's', version: 1 })
    mockReindex.mockResolvedValue({ docId: 'd1', chunkCount: 3 })

    const res = await request(makeApp())
      .post('/api/v1/admin/help/docs')
      .send({ slug: 's', title: 't', body: 'B', category: 'c' })
    expect(res.status).toBe(201)
    expect(res.body.chunkCount).toBe(3)
    expect(mockReindex).toHaveBeenCalledWith('d1')
  })

  it('returns 409 on slug-taken (P2002)', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    mockDb.helpDoc.create.mockRejectedValue(Object.assign(new Error('unique violation'), { code: 'P2002' }))

    const res = await request(makeApp())
      .post('/api/v1/admin/help/docs')
      .send({ slug: 'dup', title: 't', body: 'B', category: 'c' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('slug_taken')
  })
})

describe('PUT /api/v1/admin/help/docs/:id', () => {
  it('400 when version missing', async () => {
    const res = await request(makeApp())
      .put('/api/v1/admin/help/docs/d1')
      .send({ title: 'new' })
    expect(res.status).toBe(400)
  })

  it('404 when not found', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue(null)
    const res = await request(makeApp())
      .put('/api/v1/admin/help/docs/missing')
      .send({ version: 1, title: 'x' })
    expect(res.status).toBe(404)
  })

  it('409 on version mismatch (optimistic-lock)', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue({ id: 'd1', version: 5 })
    const res = await request(makeApp())
      .put('/api/v1/admin/help/docs/d1')
      .send({ version: 3, title: 'stale' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('version_conflict')
    expect(res.body.current.version).toBe(5)
  })

  it('updates, bumps version, reindexes on happy path', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue({ id: 'd1', version: 5 })
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_1' })
    mockDb.helpDoc.update.mockResolvedValue({ id: 'd1', version: 6, title: 'new' })
    mockReindex.mockResolvedValue({ docId: 'd1', chunkCount: 4 })

    const res = await request(makeApp())
      .put('/api/v1/admin/help/docs/d1')
      .send({ version: 5, title: 'new' })
    expect(res.status).toBe(200)
    expect(res.body.chunkCount).toBe(4)
    // Confirm the update bumped version via { increment: 1 }
    expect(mockDb.helpDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: { increment: 1 } }),
      })
    )
  })

  it('rejects invalid status', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue({ id: 'd1', version: 5 })
    const res = await request(makeApp())
      .put('/api/v1/admin/help/docs/d1')
      .send({ version: 5, status: 'BOGUS' })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/v1/admin/help/docs/:id', () => {
  it('404 when not found', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).delete('/api/v1/admin/help/docs/missing')
    expect(res.status).toBe(404)
  })

  it('204 when already archived (idempotent)', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue({ id: 'd1', status: 'ARCHIVED' })
    const res = await request(makeApp()).delete('/api/v1/admin/help/docs/d1')
    expect(res.status).toBe(204)
    expect(mockDb.helpDoc.update).not.toHaveBeenCalled()
  })

  it('204 after soft-delete sets status=ARCHIVED', async () => {
    mockDb.helpDoc.findUnique.mockResolvedValue({ id: 'd1', status: 'PUBLISHED' })
    mockDb.helpDoc.update.mockResolvedValue({ id: 'd1', status: 'ARCHIVED' })
    const res = await request(makeApp()).delete('/api/v1/admin/help/docs/d1')
    expect(res.status).toBe(204)
    expect(mockDb.helpDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ARCHIVED' }),
      })
    )
  })
})

describe('GET /api/v1/admin/help/queries (§4.1 curation list)', () => {
  it('returns paginated rows + total with default order', async () => {
    const now = new Date('2026-05-15T12:00:00Z')
    const earlier = new Date('2026-05-15T10:00:00Z')
    mockDb.helpQuery.findMany.mockResolvedValue([
      {
        id: 'q2', text: 'newer', createdAt: now, degraded: false, latencyMs: 800,
        context: {},
        answers: [{
          id: 'a2', contentFilterTriggered: false, reviewedAt: null,
          reviewedById: null,
          feedback: [{ signal: 'HELPFUL', category: null, updatedAt: now }],
        }],
      },
      {
        id: 'q1', text: 'older filter-triggered', createdAt: earlier, degraded: true, latencyMs: 1100,
        context: { route: '/play' },
        answers: [{
          id: 'a1', contentFilterTriggered: true, reviewedAt: null,
          reviewedById: null,
          feedback: [],
        }],
      },
    ])
    mockDb.helpQuery.count.mockResolvedValue(2)

    const res = await request(makeApp()).get('/api/v1/admin/help/queries')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.rows).toHaveLength(2)
    // Filter-triggered row floats to the top regardless of createdAt.
    expect(res.body.rows[0].id).toBe('q1')
    expect(res.body.rows[0].contentFilterTriggered).toBe(true)
    expect(res.body.rows[1].id).toBe('q2')
    expect(res.body.rows[1].signal).toBe('HELPFUL')
  })

  it('caps limit at 200 and clamps offset to 0', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/queries?limit=9999&offset=-1')
    expect(mockDb.helpQuery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200, skip: 0 })
    )
  })

  it('applies contentFilterTriggered=true via nested answers.some', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/queries?contentFilterTriggered=true')
    const call = mockDb.helpQuery.findMany.mock.calls[0][0]
    expect(call.where.answers.some.contentFilterTriggered).toBe(true)
  })

  it('applies unreviewed=true via answers.some.reviewedAt=null', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/queries?unreviewed=true')
    const call = mockDb.helpQuery.findMany.mock.calls[0][0]
    expect(call.where.answers.some.reviewedAt).toBeNull()
  })

  it('signal=NONE filters to answers with no feedback rows', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/queries?signal=NONE')
    const call = mockDb.helpQuery.findMany.mock.calls[0][0]
    expect(call.where.answers.some.feedback).toEqual({ none: {} })
  })

  it('signal=NOT_HELPFUL filters via answers.some.feedback.some.signal', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/queries?signal=NOT_HELPFUL&category=OUTDATED')
    const call = mockDb.helpQuery.findMany.mock.calls[0][0]
    expect(call.where.answers.some.feedback).toEqual({
      some: { signal: 'NOT_HELPFUL', category: 'OUTDATED' },
    })
  })

  it('ignores invalid signal / category values', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    await request(makeApp()).get('/api/v1/admin/help/queries?signal=BOGUS&category=BOGUS')
    const call = mockDb.helpQuery.findMany.mock.calls[0][0]
    expect(call.where.answers).toBeUndefined()
  })

  it('parses since/until into createdAt range', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    await request(makeApp()).get(
      '/api/v1/admin/help/queries?since=2026-05-14T00:00:00Z&until=2026-05-15T00:00:00Z'
    )
    const call = mockDb.helpQuery.findMany.mock.calls[0][0]
    expect(call.where.createdAt.gte).toBeInstanceOf(Date)
    expect(call.where.createdAt.lt).toBeInstanceOf(Date)
  })

  it('ignores unparseable since/until without erroring', async () => {
    mockDb.helpQuery.findMany.mockResolvedValue([])
    mockDb.helpQuery.count.mockResolvedValue(0)
    const res = await request(makeApp()).get('/api/v1/admin/help/queries?since=not-a-date')
    expect(res.status).toBe(200)
    const call = mockDb.helpQuery.findMany.mock.calls[0][0]
    expect(call.where.createdAt).toBeUndefined()
  })
})

describe('GET /api/v1/admin/help/queries/:id (§4.1 detail)', () => {
  it('returns 404 when not found', async () => {
    mockDb.helpQuery.findUnique.mockResolvedValue(null)
    const res = await request(makeApp()).get('/api/v1/admin/help/queries/missing')
    expect(res.status).toBe(404)
  })

  it('returns query + answers + retrieval-ordered chunks on happy path', async () => {
    mockDb.helpQuery.findUnique.mockResolvedValue({
      id: 'q1', text: 'how do I train a bot', createdAt: new Date(), context: {},
      answers: [{
        id: 'a1', rendered: 'Use the Gym…', chunkIds: ['c3', 'c1', 'c2'],
        contentFilterTriggered: false, contentFilterTerms: [],
        reviewedAt: null, reviewedById: null,
        feedback: [{ id: 'f1', signal: 'HELPFUL', comment: null, implicit: {} }],
      }],
    })
    mockDb.helpChunk.findMany.mockResolvedValue([
      { id: 'c1', position: 0, content: 'A', embeddingModel: 'text-embedding-3-small@384',
        doc: { slug: 'one', title: 'One', category: 'basics' } },
      { id: 'c2', position: 1, content: 'B', embeddingModel: 'text-embedding-3-small@384',
        doc: { slug: 'two', title: 'Two', category: 'basics' } },
      { id: 'c3', position: 0, content: 'C', embeddingModel: 'text-embedding-3-small@384',
        doc: { slug: 'three', title: 'Three', category: 'training' } },
    ])

    const res = await request(makeApp()).get('/api/v1/admin/help/queries/q1')
    expect(res.status).toBe(200)
    expect(res.body.query.id).toBe('q1')
    expect(res.body.query.answers[0].feedback[0].signal).toBe('HELPFUL')
    // Chunks come back in the order encoded in chunkIds (retrieval order),
    // not the DB findMany order.
    expect(res.body.chunks.map(c => c.id)).toEqual(['c3', 'c1', 'c2'])
  })

  it('returns empty chunks array when top answer has no retrieved chunks', async () => {
    mockDb.helpQuery.findUnique.mockResolvedValue({
      id: 'q1', text: 't', createdAt: new Date(), context: {},
      answers: [{ id: 'a1', rendered: '…', chunkIds: [], feedback: [] }],
    })
    const res = await request(makeApp()).get('/api/v1/admin/help/queries/q1')
    expect(res.status).toBe(200)
    expect(res.body.chunks).toEqual([])
    expect(mockDb.helpChunk.findMany).not.toHaveBeenCalled()
  })

  it('returns empty chunks when the query has no answers at all', async () => {
    mockDb.helpQuery.findUnique.mockResolvedValue({
      id: 'q1', text: 't', createdAt: new Date(), context: {}, answers: [],
    })
    const res = await request(makeApp()).get('/api/v1/admin/help/queries/q1')
    expect(res.status).toBe(200)
    expect(res.body.chunks).toEqual([])
  })
})

describe('POST /api/v1/admin/help/answers/:id/review', () => {
  it('stamps reviewedAt + reviewedById on happy path', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_admin_1' })
    mockDb.helpAnswer.update.mockResolvedValue({
      id: 'a1',
      reviewedAt:   new Date('2026-05-15T15:00:00Z'),
      reviewedById: 'usr_admin_1',
    })

    const res = await request(makeApp()).post('/api/v1/admin/help/answers/a1/review')
    expect(res.status).toBe(200)
    expect(res.body.answer.id).toBe('a1')
    expect(res.body.answer.reviewedById).toBe('usr_admin_1')
    expect(mockDb.helpAnswer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'a1' },
        data:  expect.objectContaining({
          reviewedAt:   expect.any(Date),
          reviewedById: 'usr_admin_1',
        }),
      })
    )
  })

  it('idempotent re-review updates the timestamp', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_admin_2' })
    const newStamp = new Date('2026-05-16T09:00:00Z')
    mockDb.helpAnswer.update.mockResolvedValue({
      id: 'a1', reviewedAt: newStamp, reviewedById: 'usr_admin_2',
    })

    const res = await request(makeApp()).post('/api/v1/admin/help/answers/a1/review')
    expect(res.status).toBe(200)
    expect(res.body.answer.reviewedById).toBe('usr_admin_2')
    // The update should have been called with a fresh `new Date()` — not
    // a hard-coded value — so the most recent review wins.
    const callData = mockDb.helpAnswer.update.mock.calls[0][0].data
    expect(callData.reviewedAt).toBeInstanceOf(Date)
  })

  it('404 when answer id unknown (P2025)', async () => {
    mockDb.user.findUnique.mockResolvedValue({ id: 'usr_admin_1' })
    mockDb.helpAnswer.update.mockRejectedValue(
      Object.assign(new Error('Record to update not found'), { code: 'P2025' })
    )

    const res = await request(makeApp()).post('/api/v1/admin/help/answers/missing/review')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })

  it('still stamps with null reviewedById if betterAuth → User lookup misses', async () => {
    // Edge case: HELP_ADMIN role granted via betterAuthId but the linked
    // User row was deleted. Treated like helpDoc create — `null` reviewer
    // rather than 500.
    mockDb.user.findUnique.mockResolvedValue(null)
    mockDb.helpAnswer.update.mockResolvedValue({
      id: 'a1', reviewedAt: new Date(), reviewedById: null,
    })

    const res = await request(makeApp()).post('/api/v1/admin/help/answers/a1/review')
    expect(res.status).toBe(200)
    expect(res.body.answer.reviewedById).toBeNull()
  })
})

describe('GET /api/v1/admin/help/metrics (§4.3 dashboard)', () => {
  function primeBasicMocks() {
    // $queryRaw is called twice: time series, then top-chunks. Return
    // empty arrays for both by default; specific tests override.
    mockDb.$queryRaw.mockResolvedValue([])
    mockDb.helpFeedback.groupBy.mockResolvedValue([])
    mockDb.helpAnswer.count.mockResolvedValue(0)
    mockDb.helpAnswer.findMany.mockResolvedValue([])
  }

  it('returns the full rollup shape on an empty DB', async () => {
    primeBasicMocks()
    const res = await request(makeApp()).get('/api/v1/admin/help/metrics')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      windowDays:          30,
      feedbackTotals:      { helpful: 0, notHelpful: 0, total: 0 },
      helpfulPct:          null,
      notHelpfulByCategory: [],
      filterTriggerRate:   { triggered: 0, total: 0, rate: null },
      topRetrievedChunks:  [],
      topNoSourceQueries:  [],
    })
    expect(res.body.questionsPerDay).toHaveLength(30)
    expect(res.body.questionsPerDay.every(d => d.count === 0)).toBe(true)
  })

  it('caps days at 365 and floors at 1', async () => {
    primeBasicMocks()
    const r1 = await request(makeApp()).get('/api/v1/admin/help/metrics?days=9999')
    expect(r1.body.windowDays).toBe(365)
    expect(r1.body.questionsPerDay).toHaveLength(365)

    const r2 = await request(makeApp()).get('/api/v1/admin/help/metrics?days=0')
    expect(r2.body.windowDays).toBe(30)  // 0 falls back to default
  })

  it('fills missing days with zero count', async () => {
    primeBasicMocks()
    const today = new Date().toISOString().slice(0, 10)
    // First $queryRaw call = time series; second = top chunks.
    mockDb.$queryRaw
      .mockResolvedValueOnce([{ day: new Date(`${today}T00:00:00Z`), count: 7n }])
      .mockResolvedValueOnce([])

    const res = await request(makeApp()).get('/api/v1/admin/help/metrics?days=7')
    expect(res.body.questionsPerDay).toHaveLength(7)
    const todayBucket = res.body.questionsPerDay.find(d => d.day === today)
    expect(todayBucket.count).toBe(7)
  })

  it('computes helpful% correctly from groupBy result', async () => {
    primeBasicMocks()
    mockDb.helpFeedback.groupBy.mockResolvedValueOnce([
      { signal: 'HELPFUL',     _count: { signal: 8 } },
      { signal: 'NOT_HELPFUL', _count: { signal: 2 } },
    ])
    const res = await request(makeApp()).get('/api/v1/admin/help/metrics')
    expect(res.body.feedbackTotals).toEqual({ helpful: 8, notHelpful: 2, total: 10 })
    expect(res.body.helpfulPct).toBeCloseTo(0.8, 5)
  })

  it('sorts notHelpfulByCategory desc by count', async () => {
    primeBasicMocks()
    // First groupBy = by signal (basic totals); second = by category.
    mockDb.helpFeedback.groupBy
      .mockResolvedValueOnce([{ signal: 'NOT_HELPFUL', _count: { signal: 5 } }])
      .mockResolvedValueOnce([
        { category: 'OUTDATED',  _count: { category: 1 } },
        { category: 'OFF_TOPIC', _count: { category: 4 } },
      ])
    const res = await request(makeApp()).get('/api/v1/admin/help/metrics')
    expect(res.body.notHelpfulByCategory).toEqual([
      { category: 'OFF_TOPIC', count: 4 },
      { category: 'OUTDATED',  count: 1 },
    ])
  })

  it('computes filter trigger rate from answer counts', async () => {
    primeBasicMocks()
    mockDb.helpAnswer.count
      .mockResolvedValueOnce(50)  // total
      .mockResolvedValueOnce(5)   // triggered
    const res = await request(makeApp()).get('/api/v1/admin/help/metrics')
    expect(res.body.filterTriggerRate).toEqual({
      triggered: 5, total: 50, rate: 0.1,
    })
  })

  it('returns topRetrievedChunks from the second $queryRaw call', async () => {
    primeBasicMocks()
    mockDb.$queryRaw
      .mockResolvedValueOnce([])  // time series
      .mockResolvedValueOnce([
        { id: 'c1', position: 0, slug: 'a', title: 'A', category: 'basics', hits: 12n },
        { id: 'c2', position: 1, slug: 'b', title: 'B', category: 'bots',   hits: 7n  },
      ])
    const res = await request(makeApp()).get('/api/v1/admin/help/metrics')
    expect(res.body.topRetrievedChunks).toEqual([
      { id: 'c1', position: 0, slug: 'a', title: 'A', category: 'basics', hits: 12 },
      { id: 'c2', position: 1, slug: 'b', title: 'B', category: 'bots',   hits: 7  },
    ])
  })

  it('returns topNoSourceQueries hydrated with question text', async () => {
    primeBasicMocks()
    mockDb.helpAnswer.findMany.mockResolvedValueOnce([
      { queryId: 'q1', createdAt: new Date('2026-05-15'), query: { text: 'orphan one' } },
      { queryId: 'q2', createdAt: new Date('2026-05-14'), query: { text: 'orphan two' } },
    ])
    const res = await request(makeApp()).get('/api/v1/admin/help/metrics')
    expect(res.body.topNoSourceQueries).toEqual([
      { queryId: 'q1', text: 'orphan one', createdAt: '2026-05-15T00:00:00.000Z' },
      { queryId: 'q2', text: 'orphan two', createdAt: '2026-05-14T00:00:00.000Z' },
    ])
    // The findMany call should target rank=0 + empty chunkIds.
    const call = mockDb.helpAnswer.findMany.mock.calls[0][0]
    expect(call.where.rank).toBe(0)
    expect(call.where.chunkIds).toEqual({ equals: [] })
    expect(call.take).toBe(20)
  })
})

describe('POST /api/v1/admin/help/reindex', () => {
  it('reindexes one doc when docId query is present', async () => {
    mockReindex.mockResolvedValue({ docId: 'd1', chunkCount: 3 })
    const res = await request(makeApp()).post('/api/v1/admin/help/reindex?docId=d1')
    expect(res.status).toBe(200)
    expect(res.body.results).toEqual([{ docId: 'd1', chunkCount: 3 }])
  })

  it('reindexes all docs when no query', async () => {
    mockReindexAll.mockResolvedValue([
      { docId: 'd1', chunkCount: 3 },
      { docId: 'd2', chunkCount: 5 },
    ])
    const res = await request(makeApp()).post('/api/v1/admin/help/reindex')
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(2)
  })
})
