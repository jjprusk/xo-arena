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
  user: {
    findUnique: vi.fn(),
  },
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
  mockDb.user.findUnique.mockReset()
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
