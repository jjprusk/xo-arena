import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.auth = { userId: 'ba_admin_1' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

vi.mock('../../lib/db.js', () => ({
  default: {
    log: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}))

vi.mock('../../services/mlService.js', () => ({
  getSystemConfig: vi.fn().mockResolvedValue(10_000),
  setSystemConfig: vi.fn(),
}))

const { mockAppendToStream } = vi.hoisted(() => ({
  mockAppendToStream: vi.fn().mockResolvedValue('1-0'),
}))
vi.mock('../../lib/eventStream.js', () => ({ appendToStream: mockAppendToStream }))

const logsRouter = (await import('../logs.js')).default
const db = (await import('../../lib/db.js')).default

const app = express()
app.use(express.json())
app.use('/api/v1/logs', logsRouter)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const validEntry = {
  level: 'INFO',
  source: 'frontend',
  message: 'Page loaded',
  userId: 'usr_1',
  sessionId: 'sess_1',
  roomId: null,
  meta: { page: '/home' },
  timestamp: new Date().toISOString(),
}

const mockLog = {
  id: 'log_1',
  level: 'INFO',
  source: 'frontend',
  message: 'Page loaded',
  userId: 'usr_1',
  sessionId: 'sess_1',
  roomId: null,
  meta: { page: '/home' },
  timestamp: new Date(),
}

// ─── POST /api/v1/logs ────────────────────────────────────────────────────────

describe('POST /api/v1/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.log.createMany.mockResolvedValue({ count: 1 })
    db.log.count.mockResolvedValue(100)
  })

  it('returns 400 when entries is not an array', async () => {
    const res = await request(app).post('/api/v1/logs').send({ entries: 'bad' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/entries must be an array/)
  })

  it('returns 204 and stores valid entries', async () => {
    const res = await request(app).post('/api/v1/logs').send({ entries: [validEntry] })
    expect(res.status).toBe(204)
    expect(db.log.createMany).toHaveBeenCalledOnce()
    const { data } = db.log.createMany.mock.calls[0][0]
    expect(data).toHaveLength(1)
    expect(data[0].level).toBe('INFO')
    expect(data[0].source).toBe('frontend')
    expect(data[0].message).toBe('Page loaded')
  })

  it('Phase 4: dual-emits each row to the SSE admin:logs:entry channel', async () => {
    await request(app)
      .post('/api/v1/logs')
      .send({ entries: [validEntry, { ...validEntry, message: 'second' }] })
    // Two rows in → two SSE appends out, on the same channel.
    const calls = mockAppendToStream.mock.calls.filter(([ch]) => ch === 'admin:logs:entry')
    expect(calls).toHaveLength(2)
    expect(calls[0][2]).toEqual({ userId: '*' })
  })

  it('returns 204 with no db write when all entries are invalid', async () => {
    const res = await request(app).post('/api/v1/logs').send({
      entries: [
        { level: 'BADLEVEL', source: 'frontend', message: 'x' },
        { level: 'INFO', source: 'badSource', message: 'y' },
      ],
    })
    expect(res.status).toBe(204)
    expect(db.log.createMany).not.toHaveBeenCalled()
  })

  it('filters out invalid entries but stores valid ones', async () => {
    const res = await request(app).post('/api/v1/logs').send({
      entries: [
        validEntry,
        { level: 'INVALID', source: 'frontend', message: 'bad' },
        { level: 'WARN', source: 'api', message: 'good', timestamp: new Date().toISOString() },
      ],
    })
    expect(res.status).toBe(204)
    const { data } = db.log.createMany.mock.calls[0][0]
    expect(data).toHaveLength(2)
  })

  it('accepts all valid levels', async () => {
    const levels = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']
    const entries = levels.map(level => ({ ...validEntry, level }))
    const res = await request(app).post('/api/v1/logs').send({ entries })
    expect(res.status).toBe(204)
    const { data } = db.log.createMany.mock.calls[0][0]
    expect(data).toHaveLength(5)
  })

  it('accepts all valid sources', async () => {
    const sources = ['frontend', 'api', 'realtime', 'ai']
    const entries = sources.map(source => ({ ...validEntry, source }))
    const res = await request(app).post('/api/v1/logs').send({ entries })
    expect(res.status).toBe(204)
    const { data } = db.log.createMany.mock.calls[0][0]
    expect(data).toHaveLength(4)
  })

  it('uses current time when timestamp is missing', async () => {
    const entry = { level: 'INFO', source: 'api', message: 'no ts' }
    const before = Date.now()
    await request(app).post('/api/v1/logs').send({ entries: [entry] })
    const after = Date.now()
    const { data } = db.log.createMany.mock.calls[0][0]
    const ts = new Date(data[0].timestamp).getTime()
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  it('coerces message to string', async () => {
    const entry = { level: 'INFO', source: 'api', message: 42 }
    await request(app).post('/api/v1/logs').send({ entries: [entry] })
    const { data } = db.log.createMany.mock.calls[0][0]
    expect(data[0].message).toBe('42')
  })

  it('stores null for missing optional fields', async () => {
    const entry = { level: 'INFO', source: 'api', message: 'bare' }
    await request(app).post('/api/v1/logs').send({ entries: [entry] })
    const { data } = db.log.createMany.mock.calls[0][0]
    expect(data[0].userId).toBeNull()
    expect(data[0].sessionId).toBeNull()
    expect(data[0].roomId).toBeNull()
    expect(data[0].meta).toBeNull()
  })
})

// ─── GET /api/v1/logs ─────────────────────────────────────────────────────────

describe('GET /api/v1/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.log.findMany.mockResolvedValue([mockLog])
    db.log.count.mockResolvedValue(1)
  })

  it('returns logs with pagination metadata', async () => {
    const res = await request(app).get('/api/v1/logs')
    expect(res.status).toBe(200)
    expect(res.body.logs).toHaveLength(1)
    expect(res.body.total).toBe(1)
    expect(res.body.page).toBe(1)
    expect(res.body.limit).toBe(500) // default
  })

  it('respects limit and page query params', async () => {
    db.log.findMany.mockResolvedValue([])
    db.log.count.mockResolvedValue(0)
    await request(app).get('/api/v1/logs?limit=100&page=2')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.take).toBe(100)
    expect(findArgs.skip).toBe(100) // (2-1)*100
  })

  it('clamps limit to 2000', async () => {
    await request(app).get('/api/v1/logs?limit=9999')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.take).toBe(2000)
  })

  it('filters by valid level', async () => {
    await request(app).get('/api/v1/logs?level=ERROR')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.level).toBe('ERROR')
  })

  it('ignores invalid level filter', async () => {
    await request(app).get('/api/v1/logs?level=BADLEVEL')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.level).toBeUndefined()
  })

  it('filters by valid source', async () => {
    await request(app).get('/api/v1/logs?source=realtime')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.source).toBe('realtime')
  })

  it('ignores invalid source filter', async () => {
    await request(app).get('/api/v1/logs?source=badSource')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.source).toBeUndefined()
  })

  it('filters by userId', async () => {
    await request(app).get('/api/v1/logs?userId=usr_42')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.userId).toBe('usr_42')
  })

  it('filters by sessionId', async () => {
    await request(app).get('/api/v1/logs?sessionId=sess_99')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.sessionId).toBe('sess_99')
  })

  it('filters by roomId', async () => {
    await request(app).get('/api/v1/logs?roomId=room_1')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.roomId).toBe('room_1')
  })

  it('filters by search text (case-insensitive contains)', async () => {
    await request(app).get('/api/v1/logs?search=error+text')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.where.message).toEqual({ contains: 'error text', mode: 'insensitive' })
  })

  it('orders results by timestamp descending', async () => {
    await request(app).get('/api/v1/logs')
    const [findArgs] = db.log.findMany.mock.calls[0]
    expect(findArgs.orderBy).toEqual({ timestamp: 'desc' })
  })
})
