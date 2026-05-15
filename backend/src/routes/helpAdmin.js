// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Admin-facing CRUD for HelpDoc + reindex endpoint.
 *
 * Mounted at /api/v1/admin/help. All routes require HELP_ADMIN or ADMIN.
 *
 * Optimistic locking: PUT requires the client to send the `version` it
 * fetched. On mismatch the server returns 409 with the current version so
 * the client can prompt for a reload. The version is bumped on every
 * successful update, which is also the chunk-invalidation key: any update
 * causes the chunk + embedding rebuild.
 */

import { Router } from 'express'
import { requireAuth, requireHelpAdmin } from '../middleware/auth.js'
import db from '../lib/db.js'
import logger from '../logger.js'
import { reindexDoc, reindexAll } from '../services/help/corpusSeeder.js'

const router = Router()
router.use(requireAuth, requireHelpAdmin)

const VALID_STATUS = new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED'])

/**
 * GET /docs — list with optional filters.
 *  ?status=PUBLISHED | DRAFT | ARCHIVED
 *  ?category=basics
 *  ?limit=50 (max 200)
 *  ?offset=0
 */
router.get('/docs', async (req, res, next) => {
  try {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)
    const where = {}
    if (req.query.status && VALID_STATUS.has(req.query.status)) {
      where.status = req.query.status
    }
    if (req.query.category) where.category = String(req.query.category)

    const [docs, total] = await Promise.all([
      db.helpDoc.findMany({
        where,
        orderBy: [{ category: 'asc' }, { title: 'asc' }],
        skip: offset,
        take: limit,
        select: {
          id: true, slug: true, title: true, category: true, tags: true,
          status: true, version: true, lastEditedById: true,
          createdAt: true, updatedAt: true,
        },
      }),
      db.helpDoc.count({ where }),
    ])
    res.json({ docs, total, limit, offset })
  } catch (err) { next(err) }
})

/** GET /docs/:id — single doc with full body (admin view) */
router.get('/docs/:id', async (req, res, next) => {
  try {
    const doc = await db.helpDoc.findUnique({ where: { id: req.params.id } })
    if (!doc) return res.status(404).json({ error: 'not_found' })
    res.json({ doc })
  } catch (err) { next(err) }
})

/**
 * POST /docs — create a new doc.
 * Body: { slug, title, body, category, tags?, status? }
 * Returns the created doc + initial chunks count.
 */
router.post('/docs', async (req, res, next) => {
  try {
    const { slug, title, body, category, tags, status } = req.body ?? {}
    if (!slug || !title || !body || !category) {
      return res.status(400).json({ error: 'slug/title/body/category required' })
    }
    if (status && !VALID_STATUS.has(status)) {
      return res.status(400).json({ error: `invalid status: ${status}` })
    }

    // Resolve the editor's User.id from the BetterAuth subject in req.auth.
    const editor = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })

    const doc = await db.helpDoc.create({
      data: {
        slug:           String(slug),
        title:          String(title),
        body:           String(body),
        category:       String(category),
        tags:           Array.isArray(tags) ? tags.map(String) : [],
        status:         status ?? 'PUBLISHED',
        authorId:       editor?.id ?? null,
        lastEditedById: editor?.id ?? null,
        version:        1,
      },
    })
    const { chunkCount } = await reindexDoc(doc.id)
    res.status(201).json({ doc, chunkCount })
  } catch (err) {
    // Slug-uniqueness violation → 409 with a friendly hint.
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'slug_taken' })
    }
    next(err)
  }
})

/**
 * PUT /docs/:id — update, with optimistic-lock check on `version`.
 * Body must include the `version` the client last fetched. On mismatch we
 * return 409 and the current row so the UI can show a "reload" banner.
 */
router.put('/docs/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { title, body, category, tags, status, version } = req.body ?? {}

    if (typeof version !== 'number') {
      return res.status(400).json({ error: 'version (number) required' })
    }
    if (status && !VALID_STATUS.has(status)) {
      return res.status(400).json({ error: `invalid status: ${status}` })
    }

    const current = await db.helpDoc.findUnique({ where: { id } })
    if (!current) return res.status(404).json({ error: 'not_found' })

    if (current.version !== version) {
      return res.status(409).json({
        error:   'version_conflict',
        current: current,
      })
    }

    const editor = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })

    const updated = await db.helpDoc.update({
      where: { id },
      data: {
        ...(title    !== undefined ? { title:    String(title)    } : {}),
        ...(body     !== undefined ? { body:     String(body)     } : {}),
        ...(category !== undefined ? { category: String(category) } : {}),
        ...(tags     !== undefined ? { tags:     Array.isArray(tags) ? tags.map(String) : [] } : {}),
        ...(status   !== undefined ? { status }                                          : {}),
        lastEditedById: editor?.id ?? null,
        version:        { increment: 1 },
      },
    })

    const { chunkCount } = await reindexDoc(id)
    res.json({ doc: updated, chunkCount })
  } catch (err) { next(err) }
})

/** DELETE /docs/:id — soft delete (status=ARCHIVED). */
router.delete('/docs/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const current = await db.helpDoc.findUnique({ where: { id }, select: { id: true, status: true } })
    if (!current) return res.status(404).json({ error: 'not_found' })
    if (current.status === 'ARCHIVED') return res.status(204).send()

    await db.helpDoc.update({
      where: { id },
      data:  { status: 'ARCHIVED', version: { increment: 1 } },
    })
    res.status(204).send()
  } catch (err) { next(err) }
})

/**
 * GET /queries — paginated curation list (Sprint 4 §4.1).
 *
 * Filters (all optional):
 *   ?signal=HELPFUL | NOT_HELPFUL | NONE (NONE = no feedback row exists)
 *   ?category=OFF_TOPIC | OUTDATED | WRONG | INCOMPLETE
 *   ?contentFilterTriggered=true | false
 *   ?unreviewed=true               (excludes answers with reviewedAt set)
 *   ?since=<ISO8601>               (createdAt >= since)
 *   ?until=<ISO8601>               (createdAt <  until)
 *   ?limit=50 (max 200) ?offset=0
 *
 * Default order: rows whose top answer has `contentFilterTriggered=true`
 * first, then createdAt desc. The page's default landing call passes
 * unreviewed=true + contentFilterTriggered=true + since=now-24h.
 *
 * Returns lightweight rows (no body / no chunks) — the detail endpoint
 * loads the heavy fields.
 */
const VALID_SIGNAL   = new Set(['HELPFUL', 'NOT_HELPFUL', 'NONE'])
const VALID_CATEGORY = new Set(['OFF_TOPIC', 'OUTDATED', 'WRONG', 'INCOMPLETE'])

router.get('/queries', async (req, res, next) => {
  try {
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50))
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0)

    const where = {}
    if (req.query.since) {
      const d = new Date(String(req.query.since))
      if (!Number.isNaN(d.getTime())) where.createdAt = { ...(where.createdAt ?? {}), gte: d }
    }
    if (req.query.until) {
      const d = new Date(String(req.query.until))
      if (!Number.isNaN(d.getTime())) where.createdAt = { ...(where.createdAt ?? {}), lt: d }
    }

    // Filters that key off the top answer / feedback live in nested
    // some-clauses so a single query can express them all.
    const answerSome = {}
    if (req.query.contentFilterTriggered === 'true')  answerSome.contentFilterTriggered = true
    if (req.query.contentFilterTriggered === 'false') answerSome.contentFilterTriggered = false
    if (req.query.unreviewed === 'true')              answerSome.reviewedAt = null

    const feedbackWhere = {}
    if (req.query.signal && VALID_SIGNAL.has(req.query.signal)) {
      if (req.query.signal === 'NONE') {
        // "No feedback" — no HelpFeedback row exists at all.
        answerSome.feedback = { none: {} }
      } else {
        feedbackWhere.signal = req.query.signal
      }
    }
    if (req.query.category && VALID_CATEGORY.has(req.query.category)) {
      feedbackWhere.category = req.query.category
    }
    if (Object.keys(feedbackWhere).length > 0) {
      answerSome.feedback = { some: feedbackWhere }
    }
    if (Object.keys(answerSome).length > 0) {
      where.answers = { some: answerSome }
    }

    const [rowsRaw, total] = await Promise.all([
      db.helpQuery.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip:    offset,
        take:    limit,
        select: {
          id: true, text: true, createdAt: true, degraded: true,
          context: true, latencyMs: true,
          answers: {
            orderBy: { rank: 'asc' },
            take:    1,
            select:  {
              id: true, contentFilterTriggered: true, reviewedAt: true,
              reviewedById: true,
              feedback: {
                select: { signal: true, category: true, updatedAt: true },
              },
            },
          },
        },
      }),
      db.helpQuery.count({ where }),
    ])

    // Hoist the top-answer's signal + filter flag onto the row so the
    // UI can render badges without flattening shape client-side.
    const rows = rowsRaw.map(q => {
      const top = q.answers[0] ?? null
      const fb  = top?.feedback?.[0] ?? null
      return {
        id:                     q.id,
        text:                   q.text,
        createdAt:              q.createdAt,
        degraded:               q.degraded,
        latencyMs:              q.latencyMs,
        context:                q.context,
        topAnswerId:            top?.id ?? null,
        contentFilterTriggered: top?.contentFilterTriggered ?? false,
        reviewedAt:             top?.reviewedAt ?? null,
        reviewedById:           top?.reviewedById ?? null,
        signal:                 fb?.signal ?? null,
        category:               fb?.category ?? null,
      }
    })

    // Filter-triggered rows float to the top — done in-app so we can
    // keep a single Prisma orderBy on createdAt (Postgres CASE-WHEN
    // ordering needs raw SQL).
    rows.sort((a, b) => {
      if (a.contentFilterTriggered !== b.contentFilterTriggered) {
        return a.contentFilterTriggered ? -1 : 1
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    res.json({ rows, total, limit, offset })
  } catch (err) { next(err) }
})

/**
 * GET /queries/:id — single curation row with everything needed for the
 * detail view: rendered answer, retrieved chunks (slug + title + snippet),
 * full context, every feedback row, and the matched content-filter terms.
 */
router.get('/queries/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const query = await db.helpQuery.findUnique({
      where: { id },
      include: {
        answers: {
          orderBy: { rank: 'asc' },
          include: {
            feedback: {
              orderBy: { updatedAt: 'desc' },
              select:  {
                id: true, userId: true, signal: true, category: true,
                comment: true, implicit: true, updatedAt: true,
              },
            },
          },
        },
      },
    })
    if (!query) return res.status(404).json({ error: 'not_found' })

    // Hydrate retrieved chunks for the top answer (in retrieval order).
    const top = query.answers[0] ?? null
    let chunks = []
    if (top && Array.isArray(top.chunkIds) && top.chunkIds.length > 0) {
      const found = await db.helpChunk.findMany({
        where:  { id: { in: top.chunkIds } },
        select: {
          id: true, position: true, content: true, embeddingModel: true,
          doc: { select: { slug: true, title: true, category: true } },
        },
      })
      // Preserve the original retrieval order from chunkIds.
      const byId = new Map(found.map(c => [c.id, c]))
      chunks = top.chunkIds.map(cid => byId.get(cid)).filter(Boolean)
    }

    res.json({ query, chunks })
  } catch (err) { next(err) }
})

/**
 * POST /answers/:id/review — stamp HelpAnswer as reviewed by the calling
 * HELP_ADMIN. Idempotent (re-review updates the timestamp + reviewer).
 * Sprint 4 §4.2. The curation queue (§4.1) calls this from the row
 * detail view.
 */
router.post('/answers/:id/review', async (req, res, next) => {
  try {
    const { id } = req.params
    const editor = await db.user.findUnique({
      where: { betterAuthId: req.auth.userId },
      select: { id: true },
    })

    try {
      const answer = await db.helpAnswer.update({
        where: { id },
        data:  { reviewedAt: new Date(), reviewedById: editor?.id ?? null },
        select: { id: true, reviewedAt: true, reviewedById: true },
      })
      res.json({ answer })
    } catch (err) {
      if (err?.code === 'P2025') return res.status(404).json({ error: 'not_found' })
      throw err
    }
  } catch (err) { next(err) }
})

/**
 * GET /metrics — Sprint 4 §4.3 metrics rollups.
 *
 * Window defaults to last 30 days; override with ?days=N (max 365).
 * Returns six rollups in a single call so the dashboard doesn't have to
 * fan out:
 *   questionsPerDay  — [{ day: ISO date, count: int }]   (length = days)
 *   feedbackTotals   — { helpful, notHelpful, total }
 *   helpfulPct       — number in [0..1] or null when both totals are 0
 *   notHelpfulByCategory — [{ category, count }] desc
 *   filterTriggerRate — { triggered, total, rate }
 *   topRetrievedChunks  — top 10 chunks by retrieval count (slug + title)
 *   topNoSourceQueries  — last 20 queries whose top answer had no chunks
 */
router.get('/metrics', async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // ── Time series: questions per day ────────────────────────────────
    // Use date_trunc on UTC; fill missing days with zero in JS.
    const seriesRaw = await db.$queryRaw`
      SELECT date_trunc('day', "createdAt")::date AS day, COUNT(*)::int AS count
      FROM "help_queries"
      WHERE "createdAt" >= ${since}
      GROUP BY day
      ORDER BY day ASC
    `
    const dayMap = new Map(
      (seriesRaw ?? []).map(r => [new Date(r.day).toISOString().slice(0, 10), Number(r.count)])
    )
    const questionsPerDay = []
    for (let i = 0; i < days; i += 1) {
      const d = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      questionsPerDay.push({ day: key, count: dayMap.get(key) ?? 0 })
    }

    // ── Feedback totals + helpful% ────────────────────────────────────
    const feedbackBySignal = await db.helpFeedback.groupBy({
      by:    ['signal'],
      where: { updatedAt: { gte: since }, signal: { not: null } },
      _count: { signal: true },
    })
    const helpful    = feedbackBySignal.find(r => r.signal === 'HELPFUL')?._count.signal     ?? 0
    const notHelpful = feedbackBySignal.find(r => r.signal === 'NOT_HELPFUL')?._count.signal ?? 0
    const fbTotal   = helpful + notHelpful
    const feedbackTotals = { helpful, notHelpful, total: fbTotal }
    const helpfulPct = fbTotal > 0 ? helpful / fbTotal : null

    // ── NOT_HELPFUL by category ───────────────────────────────────────
    const byCategoryRaw = await db.helpFeedback.groupBy({
      by:    ['category'],
      where: { updatedAt: { gte: since }, signal: 'NOT_HELPFUL', category: { not: null } },
      _count: { category: true },
    })
    const notHelpfulByCategory = byCategoryRaw
      .map(r => ({ category: r.category, count: r._count.category }))
      .sort((a, b) => b.count - a.count)

    // ── Filter trigger rate ───────────────────────────────────────────
    const [answerTotal, filterTriggered] = await Promise.all([
      db.helpAnswer.count({ where: { createdAt: { gte: since } } }),
      db.helpAnswer.count({ where: { createdAt: { gte: since }, contentFilterTriggered: true } }),
    ])
    const filterTriggerRate = {
      triggered: filterTriggered,
      total:     answerTotal,
      rate:      answerTotal > 0 ? filterTriggered / answerTotal : null,
    }

    // ── Top retrieved chunks ──────────────────────────────────────────
    // Unnest chunkIds → group + count. Join helpChunk + helpDoc for the
    // friendly title. Raw SQL is the clean way to express this; Prisma
    // doesn't have an array-unnest aggregation primitive.
    const topChunksRaw = await db.$queryRaw`
      SELECT c.id, c.position, d.slug, d.title, d.category, COUNT(*)::int AS hits
      FROM "help_answers" a
      CROSS JOIN LATERAL unnest(a."chunkIds") AS cid
      JOIN "help_chunks" c ON c.id = cid
      JOIN "help_docs"   d ON d.id = c."docId"
      WHERE a."createdAt" >= ${since}
      GROUP BY c.id, c.position, d.slug, d.title, d.category
      ORDER BY hits DESC
      LIMIT 10
    `
    const topRetrievedChunks = (topChunksRaw ?? []).map(r => ({
      id:       r.id,
      position: r.position,
      slug:     r.slug,
      title:    r.title,
      category: r.category,
      hits:     Number(r.hits),
    }))

    // ── Top no-source queries (zero chunks retrieved) ────────────────
    // Recent queries whose first answer had an empty chunkIds array —
    // these are the gap-filling candidates for new docs.
    const noSourceAnswers = await db.helpAnswer.findMany({
      where:   { createdAt: { gte: since }, rank: 0, chunkIds: { equals: [] } },
      orderBy: { createdAt: 'desc' },
      take:    20,
      select:  { queryId: true, createdAt: true, query: { select: { text: true } } },
    })
    const topNoSourceQueries = noSourceAnswers.map(a => ({
      queryId:   a.queryId,
      text:      a.query?.text ?? '',
      createdAt: a.createdAt,
    }))

    res.json({
      windowDays: days,
      since:      since.toISOString(),
      questionsPerDay,
      feedbackTotals,
      helpfulPct,
      notHelpfulByCategory,
      filterTriggerRate,
      topRetrievedChunks,
      topNoSourceQueries,
    })
  } catch (err) { next(err) }
})

/**
 * POST /reindex — rebuild chunks + embeddings.
 *  ?docId=... → single doc
 *  no query   → all docs
 *
 * Synchronous in v1 — the corpus is small enough that this finishes in
 * <2s even with the embed stub. When the real xo-llm embed is wired
 * (Sprint 2) we'll revisit; if it's slow enough to time out HTTP, push
 * into a background job.
 */
router.post('/reindex', async (req, res, next) => {
  try {
    if (req.query.docId) {
      const r = await reindexDoc(String(req.query.docId))
      return res.json({ results: [r] })
    }
    const results = await reindexAll()
    res.json({ results })
  } catch (err) {
    logger.warn({ err: err.message }, 'help admin reindex failed')
    next(err)
  }
})

export default router
