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
