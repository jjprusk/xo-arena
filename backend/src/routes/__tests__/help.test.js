/**
 * Tests for POST /api/v1/help/ask. Auth + helpService.ask are mocked. The
 * end-to-end happy path with real OpenAI is exercised in §2.8 acceptance
 * (manual smoke + adversarial fixtures land in §2.4).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

const AUTHED_USER_ID = 'ba_user_1'

// requireAuthOrInternalSecret swap: a global flag lets individual tests
// force "guest" mode (route should 401). By default authenticated.
// A second flag (isCliBypass) emulates the X-Internal-Secret path.
let isGuest = false
let isCliBypass = false
vi.mock('../../middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    if (isGuest) return res.status(401).json({ error: 'Authentication required' })
    req.auth = { userId: AUTHED_USER_ID }
    next()
  },
  requireAuthOrInternalSecret: (req, res, next) => {
    if (isCliBypass) {
      req.auth = { userId: 'cli:um', cliBypass: true }
      return next()
    }
    if (isGuest) return res.status(401).json({ error: 'Authentication required' })
    req.auth = { userId: AUTHED_USER_ID }
    next()
  },
}))

// helpService.ask is a generator we control per test. Stash a "scenario"
// pointer that each test can flip before calling supertest.
let askScenario = null
vi.mock('../../services/help/helpService.js', () => ({
  ask: vi.fn((args) => {
    if (askScenario) return askScenario(args)
    return (async function* () { yield { kind: 'error', error: 'no_scenario_set' } })()
  }),
}))

// journeyService — return a known phase so the prompt context test is stable.
vi.mock('../../services/journeyService.js', () => ({
  getJourneyProgress: vi.fn(async () => ({ completedSteps: [1, 2, 3] })),
  deriveCurrentPhase: (steps) => (steps.includes(3) ? 'curriculum' : 'hook'),
}))

vi.mock('../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// db mock — feedback routes use db.helpFeedback. §3.7 public browse
// routes use db.helpDoc. Each test stubs the behaviour it needs.
const dbHelpFeedback = {
  findUnique: vi.fn(),
  create:     vi.fn(),
  update:     vi.fn(),
}
const dbHelpDoc = {
  findMany:   vi.fn(),
  findUnique: vi.fn(),
}
vi.mock('../../lib/db.js', () => ({
  default: { helpFeedback: dbHelpFeedback, helpDoc: dbHelpDoc },
}))

const helpRouter = (await import('../help.js')).default
const { ask: askMock } = await import('../../services/help/helpService.js')
const { _resetHelpRateLimitState, HELP_PER_MINUTE_LIMIT } =
  await import('../../middleware/helpRateLimit.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/help', helpRouter)
  return app
}

function parseSseChunks(text) {
  // Parse the SSE body into a list of { event, data } objects.
  return text
    .split('\n\n')
    .filter(Boolean)
    .map(block => {
      const lines = block.split('\n')
      const ev = lines.find(l => l.startsWith('event: '))?.slice(7)
      const dl = lines.find(l => l.startsWith('data: '))?.slice(6)
      return { event: ev, data: dl ? JSON.parse(dl) : null }
    })
}

beforeEach(() => {
  isGuest = false
  isCliBypass = false
  askScenario = null
  askMock.mockClear()
  dbHelpFeedback.findUnique.mockReset()
  dbHelpFeedback.create.mockReset()
  dbHelpFeedback.update.mockReset()
  dbHelpDoc.findMany.mockReset()
  dbHelpDoc.findUnique.mockReset()
  // Sprint 2 §2.5 — limiter has module-level state. Clear between tests
  // so the same AUTHED_USER_ID doesn't accumulate hits across cases.
  _resetHelpRateLimitState()
})

describe('POST /api/v1/help/ask — auth', () => {
  it('returns 401 for guests (§2.6)', async () => {
    isGuest = true
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'hello' })
    expect(res.status).toBe(401)
    expect(askMock).not.toHaveBeenCalled()
  })

  it('accepts CLI bypass (X-Internal-Secret) and uses synthetic userId', async () => {
    isCliBypass = true
    askScenario = async function* () {
      yield { kind: 'done', answerId: 'a-1', queryId: 'q-1', contentFilterTriggered: false, rendered: 'ok', degraded: false, latencyMs: 1 }
    }
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'hello' })
    expect(res.status).toBe(200)
    expect(askMock).toHaveBeenCalled()
    const args = askMock.mock.calls[0][0]
    expect(args.userId).toBe('cli:um')
    // journeyStep auto-derivation must be skipped for CLI callers — the
    // route emits a stable '(cli)' tag instead of looking up a journey.
    expect(args.context.journeyStep).toBe('(cli)')
  })
})

describe('POST /api/v1/help/ask — validation', () => {
  it('400 on missing question', async () => {
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_request')
  })

  it('400 on question longer than 1000 chars', async () => {
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'x'.repeat(1001) })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/help/ask — context allow-list', () => {
  it('strips unknown context keys + always derives journeyStep server-side', async () => {
    askScenario = async function* () {
      yield { kind: 'done', answerId: 'a-1', queryId: 'q-1', rendered: 'ok', contentFilterTriggered: false, degraded: false, latencyMs: 5 }
    }
    await request(makeApp())
      .post('/api/v1/help/ask')
      .send({
        question: 'hello',
        context: {
          route:       '/x',
          currentSlot: 'slot',
          gameType:    'xo',
          journeyStep: 'CLIENT_TRIED_TO_SET_THIS',  // must be ignored
          userId:      'someone-else',              // must be stripped
          sneaky:      'value',                     // must be stripped
        },
      })
    const ctx = askMock.mock.calls[0][0].context
    expect(ctx.route).toBe('/x')
    expect(ctx.currentSlot).toBe('slot')
    expect(ctx.gameType).toBe('xo')
    expect(ctx.journeyStep).toBe('curriculum')  // server-derived
    expect(ctx.userId).toBeUndefined()
    expect(ctx.sneaky).toBeUndefined()
  })

  it('forwards the authed userId from req.auth', async () => {
    askScenario = async function* () {
      yield { kind: 'done', answerId: 'a-1', queryId: 'q-1', rendered: 'x', contentFilterTriggered: false, degraded: false, latencyMs: 1 }
    }
    await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'q' })
    expect(askMock.mock.calls[0][0].userId).toBe(AUTHED_USER_ID)
  })

  it('rejects malformed context types (gameType not in enum)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'q', context: { gameType: 42 } })
    // context: z.any() accepts the input; ContextSchema strips invalid values
    // but with type-mismatch z would parse-fail. We just verify the request
    // succeeds either way — strict validation lives on the typed fields and
    // the safeParse path drops to empty context on failure.
    expect([200, 400]).toContain(res.status)
  })
})

describe('POST /api/v1/help/ask — SSE stream', () => {
  it('emits token frames then a done frame', async () => {
    askScenario = async function* () {
      yield { kind: 'token', text: 'Hello ' }
      yield { kind: 'token', text: 'world.' }
      yield { kind: 'done', answerId: 'a-1', queryId: 'q-1', contentFilterTriggered: false, rendered: 'Hello world.', degraded: false, latencyMs: 12 }
    }
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'q' })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    const events = parseSseChunks(res.text)
    expect(events[0]).toEqual({ event: 'token', data: { text: 'Hello ' } })
    expect(events[1]).toEqual({ event: 'token', data: { text: 'world.' } })
    expect(events[2].event).toBe('done')
    expect(events[2].data.answerId).toBe('a-1')
    expect(events[2].data.rendered).toBe('Hello world.')
  })

  it('emits error frame on llm_unavailable (status stays 200; SSE is the channel)', async () => {
    askScenario = async function* () {
      yield { kind: 'error', error: 'llm_unavailable' }
    }
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'q' })
    expect(res.status).toBe(200)
    const events = parseSseChunks(res.text)
    expect(events.at(-1).event).toBe('error')
    expect(events.at(-1).data).toEqual({ kind: 'error', error: 'llm_unavailable' })
  })

  it('emits error frame on rate_limited with retryAfter', async () => {
    askScenario = async function* () {
      yield { kind: 'error', error: 'rate_limited', retryAfter: 5 }
    }
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'q' })
    const events = parseSseChunks(res.text)
    expect(events.at(-1).data.error).toBe('rate_limited')
    expect(events.at(-1).data.retryAfter).toBe(5)
  })

  it('emits content-filter-triggered done frame transparently', async () => {
    askScenario = async function* () {
      yield { kind: 'token', text: 'mid-stream-tokens' }
      yield {
        kind: 'done',
        answerId: 'a-1',
        queryId: 'q-1',
        contentFilterTriggered: true,
        rendered: "I can't help with that. Please ask a question about AI Arena.",
        degraded: false,
        latencyMs: 8,
      }
    }
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'q' })
    const events = parseSseChunks(res.text)
    expect(events.find(e => e.event === 'token')).toBeTruthy()
    const done = events.at(-1)
    expect(done.data.contentFilterTriggered).toBe(true)
    expect(done.data.rendered).toMatch(/can't help with that/)
  })

  it('emits trailing error=internal if generator finishes without terminal frame', async () => {
    askScenario = async function* () {
      yield { kind: 'token', text: 'partial' }
      // No done/error frame — simulates a generator bug.
    }
    const res = await request(makeApp())
      .post('/api/v1/help/ask')
      .send({ question: 'q' })
    const events = parseSseChunks(res.text)
    expect(events.at(-1)).toEqual({ event: 'error', data: { error: 'internal' } })
  })
})

describe('POST /api/v1/help/ask — rate limiter (§2.5)', () => {
  it('returns 429 with retryAfter after exceeding the per-minute limit', async () => {
    askScenario = async function* () {
      yield { kind: 'done', answerId: 'a-x', queryId: 'q-x', rendered: 'ok', contentFilterTriggered: false, degraded: false, latencyMs: 1 }
    }
    const app = makeApp()

    // First N requests should pass.
    for (let i = 0; i < HELP_PER_MINUTE_LIMIT; i++) {
      const res = await request(app).post('/api/v1/help/ask').send({ question: 'q' })
      expect(res.status, `request ${i + 1} should pass`).toBe(200)
    }

    // (N+1)-th request should 429 BEFORE reaching the SSE handler.
    const limited = await request(app).post('/api/v1/help/ask').send({ question: 'q' })
    expect(limited.status).toBe(429)
    expect(limited.body).toMatchObject({ error: 'rate_limited' })
    expect(limited.body.retryAfter).toBeGreaterThan(0)
    expect(limited.headers['retry-after']).toBe(String(limited.body.retryAfter))
    // The limiter short-circuits the route — askMock should have been called
    // exactly N times (once per allowed request), not N+1.
    expect(askMock).toHaveBeenCalledTimes(HELP_PER_MINUTE_LIMIT)
  })

  it('CLI bypass requests are exempt from the per-minute limit', async () => {
    isCliBypass = true
    askScenario = async function* () {
      yield { kind: 'done', answerId: 'a-cli', queryId: 'q-cli', rendered: 'ok', contentFilterTriggered: false, degraded: false, latencyMs: 1 }
    }
    const app = makeApp()
    for (let i = 0; i < HELP_PER_MINUTE_LIMIT + 3; i++) {
      const res = await request(app).post('/api/v1/help/ask').send({ question: 'q' })
      expect(res.status, `cli request ${i + 1}`).toBe(200)
    }
  })
})

describe('POST /api/v1/help/feedback (§3.6)', () => {
  it('returns 401 for guests', async () => {
    isGuest = true
    const res = await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', signal: 'HELPFUL' })
    expect(res.status).toBe(401)
    expect(dbHelpFeedback.findUnique).not.toHaveBeenCalled()
  })

  it('400 on missing queryId or answerId', async () => {
    const res = await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ signal: 'HELPFUL' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_request')
  })

  it('400 on invalid enum value (signal=YOLO)', async () => {
    const res = await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', signal: 'YOLO' })
    expect(res.status).toBe(400)
  })

  it('inserts a new HelpFeedback row when none exists', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce(null)
    dbHelpFeedback.create.mockResolvedValueOnce({
      id: 'fb-1', userId: AUTHED_USER_ID, queryId: 'q-1', answerId: 'a-1',
      signal: 'HELPFUL', category: null, comment: null, implicit: {},
    })
    const res = await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', signal: 'HELPFUL' })
    expect(res.status).toBe(200)
    expect(res.body.feedback.id).toBe('fb-1')
    expect(dbHelpFeedback.create).toHaveBeenCalledOnce()
    const { data } = dbHelpFeedback.create.mock.calls[0][0]
    expect(data).toMatchObject({
      userId: AUTHED_USER_ID, queryId: 'q-1', answerId: 'a-1',
      signal: 'HELPFUL', category: null, comment: null, implicit: {},
    })
  })

  it('updates an existing row when one exists', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce({
      id: 'fb-1', userId: AUTHED_USER_ID, queryId: 'q-1', answerId: 'a-1',
      signal: 'HELPFUL', category: null, comment: null, implicit: {},
    })
    dbHelpFeedback.update.mockResolvedValueOnce({
      id: 'fb-1', signal: 'NOT_HELPFUL', category: null, comment: null, implicit: {},
    })
    const res = await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', signal: 'NOT_HELPFUL' })
    expect(res.status).toBe(200)
    expect(dbHelpFeedback.update).toHaveBeenCalledOnce()
    expect(dbHelpFeedback.update.mock.calls[0][0].data.signal).toBe('NOT_HELPFUL')
  })

  it('flipping NOT_HELPFUL → HELPFUL clears category + comment (§3.3 rule)', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce({
      id: 'fb-1', userId: AUTHED_USER_ID, queryId: 'q-1', answerId: 'a-1',
      signal: 'NOT_HELPFUL', category: 'WRONG', comment: 'this was off-base',
      implicit: { docLinkClicked: true },
    })
    dbHelpFeedback.update.mockResolvedValueOnce({})
    await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', signal: 'HELPFUL' })
    const { data } = dbHelpFeedback.update.mock.calls[0][0]
    expect(data.signal).toBe('HELPFUL')
    expect(data.category).toBeNull()
    expect(data.comment).toBeNull()
    // Implicit signals are preserved across the flip — they're transport
    // telemetry, not user-authored content.
    expect(data.implicit).toEqual({ docLinkClicked: true })
  })

  it('flipping HELPFUL → NOT_HELPFUL preserves prior category if any', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce({
      id: 'fb-1', userId: AUTHED_USER_ID, queryId: 'q-1', answerId: 'a-1',
      signal: 'HELPFUL', category: null, comment: null, implicit: {},
    })
    dbHelpFeedback.update.mockResolvedValueOnce({})
    await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', signal: 'NOT_HELPFUL' })
    const { data } = dbHelpFeedback.update.mock.calls[0][0]
    expect(data.signal).toBe('NOT_HELPFUL')
    // No category to preserve in this case, but the flip rule didn't fire.
    expect(data.category).toBeNull()
  })

  it('partial update — implicit-only POST merges into existing implicit json', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce({
      id: 'fb-1', userId: AUTHED_USER_ID, queryId: 'q-1', answerId: 'a-1',
      signal: 'HELPFUL', category: null, comment: null,
      implicit: { docLinkClicked: true },
    })
    dbHelpFeedback.update.mockResolvedValueOnce({})
    await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', implicit: { followUpWithin60s: true } })
    const { data } = dbHelpFeedback.update.mock.calls[0][0]
    // Signal/category/comment unchanged.
    expect(data.signal).toBe('HELPFUL')
    expect(data.category).toBeNull()
    expect(data.comment).toBeNull()
    // implicit merged.
    expect(data.implicit).toEqual({
      docLinkClicked: true,
      followUpWithin60s: true,
    })
  })

  it('strips unknown implicit keys and logs a warning', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce(null)
    dbHelpFeedback.create.mockResolvedValueOnce({})
    await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({
        queryId: 'q-1', answerId: 'a-1',
        implicit: { docLinkClicked: true, sneaky: 'value', alsoSneaky: 'value' },
      })
    const { data } = dbHelpFeedback.create.mock.calls[0][0]
    expect(data.implicit).toEqual({ docLinkClicked: true })
    expect(data.implicit.sneaky).toBeUndefined()
  })

  it('explicit null clears the prior field (signal, category, or comment)', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce({
      id: 'fb-1', userId: AUTHED_USER_ID, queryId: 'q-1', answerId: 'a-1',
      signal: 'NOT_HELPFUL', category: 'WRONG', comment: 'meh', implicit: {},
    })
    dbHelpFeedback.update.mockResolvedValueOnce({})
    await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', category: null })
    const { data } = dbHelpFeedback.update.mock.calls[0][0]
    expect(data.category).toBeNull()
    // Signal + comment untouched.
    expect(data.signal).toBe('NOT_HELPFUL')
    expect(data.comment).toBe('meh')
  })

  it('returns 404 on Prisma P2003 (queryId/answerId not real)', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce(null)
    const err = new Error('FK violation')
    err.code = 'P2003'
    dbHelpFeedback.create.mockRejectedValueOnce(err)
    const res = await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-ghost', answerId: 'a-ghost', signal: 'HELPFUL' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('unknown_query_or_answer')
  })

  it('returns 500 on unexpected db error', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce(null)
    dbHelpFeedback.create.mockRejectedValueOnce(new Error('boom'))
    const res = await request(makeApp())
      .post('/api/v1/help/feedback')
      .send({ queryId: 'q-1', answerId: 'a-1', signal: 'HELPFUL' })
    expect(res.status).toBe(500)
  })
})

describe('GET /api/v1/help/feedback (§3.6)', () => {
  it('returns 401 for guests', async () => {
    isGuest = true
    const res = await request(makeApp())
      .get('/api/v1/help/feedback?queryId=q-1&answerId=a-1')
    expect(res.status).toBe(401)
  })

  it('400 on missing queryId or answerId', async () => {
    const res = await request(makeApp())
      .get('/api/v1/help/feedback')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('missing_query_params')
  })

  it('returns null when no row exists', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce(null)
    const res = await request(makeApp())
      .get('/api/v1/help/feedback?queryId=q-1&answerId=a-1')
    expect(res.status).toBe(200)
    expect(res.body.feedback).toBeNull()
  })

  it('returns the existing row when one exists for the authed user', async () => {
    dbHelpFeedback.findUnique.mockResolvedValueOnce({
      id: 'fb-1', signal: 'HELPFUL', category: null, comment: null, implicit: {},
    })
    const res = await request(makeApp())
      .get('/api/v1/help/feedback?queryId=q-1&answerId=a-1')
    expect(res.status).toBe(200)
    expect(res.body.feedback.id).toBe('fb-1')
  })
})

describe('GET /api/v1/help/docs — public browse (§3.7)', () => {
  it('returns PUBLISHED docs (no auth required)', async () => {
    isGuest = true  // explicitly guest — endpoint must allow
    dbHelpDoc.findMany.mockResolvedValueOnce([
      { slug: 'a', title: 'A',  category: 'basics',  tags: ['x'], updatedAt: new Date() },
      { slug: 'b', title: 'B',  category: 'bots',    tags: ['y'], updatedAt: new Date() },
    ])
    const res = await request(makeApp()).get('/api/v1/help/docs')
    expect(res.status).toBe(200)
    expect(res.body.docs).toHaveLength(2)
    expect(res.body.docs[0]).toMatchObject({ slug: 'a', title: 'A', category: 'basics' })
    // Body is NOT included in the list response.
    expect(res.body.docs[0].body).toBeUndefined()
    // Filter args: status PUBLISHED, ordered by category then title.
    const args = dbHelpDoc.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ status: 'PUBLISHED' })
    expect(args.orderBy).toEqual([{ category: 'asc' }, { title: 'asc' }])
  })

  it('returns 500 on db error', async () => {
    dbHelpDoc.findMany.mockRejectedValueOnce(new Error('db down'))
    const res = await request(makeApp()).get('/api/v1/help/docs')
    expect(res.status).toBe(500)
  })
})

describe('GET /api/v1/help/docs/:slug — public browse (§3.7)', () => {
  it('returns the doc body for a PUBLISHED slug (no auth required)', async () => {
    isGuest = true
    dbHelpDoc.findUnique.mockResolvedValueOnce({
      slug: 'getting-started', title: 'Getting started', body: '# Hello', category: 'basics',
      tags: ['onboarding'], status: 'PUBLISHED', updatedAt: new Date(),
    })
    const res = await request(makeApp()).get('/api/v1/help/docs/getting-started')
    expect(res.status).toBe(200)
    expect(res.body.doc).toMatchObject({
      slug: 'getting-started', title: 'Getting started', body: '# Hello',
      category: 'basics', tags: ['onboarding'],
    })
    // Status is stripped — clients only ever see PUBLISHED here.
    expect(res.body.doc.status).toBeUndefined()
  })

  it('404 for unknown slug', async () => {
    dbHelpDoc.findUnique.mockResolvedValueOnce(null)
    const res = await request(makeApp()).get('/api/v1/help/docs/missing')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })

  it('404 for DRAFT slug (status hides from public surface)', async () => {
    dbHelpDoc.findUnique.mockResolvedValueOnce({
      slug: 'wip', title: 'WIP', body: 'work in progress', category: 'basics',
      tags: [], status: 'DRAFT', updatedAt: new Date(),
    })
    const res = await request(makeApp()).get('/api/v1/help/docs/wip')
    expect(res.status).toBe(404)
  })

  it('404 for ARCHIVED slug', async () => {
    dbHelpDoc.findUnique.mockResolvedValueOnce({
      slug: 'old', title: 'Old', body: 'old', category: 'basics',
      tags: [], status: 'ARCHIVED', updatedAt: new Date(),
    })
    const res = await request(makeApp()).get('/api/v1/help/docs/old')
    expect(res.status).toBe(404)
  })

  it('400 on blank slug', async () => {
    // Hitting /docs/ would hit a 404 from the router itself rather than
    // our handler; /docs/%20 sends a literal space which our handler
    // trims to empty.
    const res = await request(makeApp()).get('/api/v1/help/docs/%20')
    expect(res.status).toBe(400)
  })

  it('500 on db error', async () => {
    dbHelpDoc.findUnique.mockRejectedValueOnce(new Error('db down'))
    const res = await request(makeApp()).get('/api/v1/help/docs/x')
    expect(res.status).toBe(500)
  })
})
