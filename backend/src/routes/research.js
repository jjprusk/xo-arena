// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /api/v1/research — User Research Log endpoints (Sprint 1).
 *
 * See doc/Research_Log_Plan.md §§2.2, 3 (Sprint 1).
 *
 * Sprint 1 surface: notes attached to TrainingSession rows. CRUD only;
 * publish / community / Help-retrieval integration ship in Sprints 2 & 3.
 *
 * Ownership: TrainingSession has no direct userId — ownership flows
 * TrainingSession.modelId → BotSkill.createdBy. We resolve that once at
 * create-time and stamp `userId` onto the note row, so subsequent mutations
 * can owner-check against the denormalized field without re-JOINing.
 */

import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import logger from '../logger.js'
import db from '../lib/db.js'

const router = Router()

const MAX_BODY_BYTES = 2 * 1024 // 2 KB per plan §C4
const MAX_TAGS       = 10
const MAX_TAG_LEN    = 32
// Accept loose tag input; normalizeTags() lowercases and dedups.
const TAG_PATTERN    = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const NOTE_OUTCOMES  = ['SUCCESS', 'PLATEAU', 'REGRESSION', 'INCONCLUSIVE']

const TagSchema = z.string()
  .min(1).max(MAX_TAG_LEN)
  .regex(TAG_PATTERN, 'tag must contain only letters, digits, _ or -')

const OutcomeSchema = z.enum(NOTE_OUTCOMES)

const CreateBodySchema = z.object({
  body:    z.string().min(1),
  outcome: OutcomeSchema,
  tags:    z.array(TagSchema).max(MAX_TAGS).optional(),
})

const PatchBodySchema = z.object({
  body:    z.string().min(1).optional(),
  outcome: OutcomeSchema.optional(),
  tags:    z.array(TagSchema).max(MAX_TAGS).optional(),
}).refine(
  obj => Object.keys(obj).length > 0,
  { message: 'at least one field must be provided' },
)

const ListQuerySchema = z.object({
  outcome: OutcomeSchema.optional(),
  tag:     z.string().min(1).max(MAX_TAG_LEN).optional(),
  since:   z.string().datetime().optional(),
  limit:   z.coerce.number().int().min(1).max(200).optional(),
})

function byteLen(s) {
  return Buffer.byteLength(s ?? '', 'utf8')
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  const seen = new Set()
  const out = []
  for (const raw of tags) {
    const t = String(raw).trim().toLowerCase().replace(/-/g, '_')
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * Resolve the owning userId for a TrainingSession by walking
 * `TrainingSession.model.createdBy`. Returns null when the session does not
 * exist or has no owner (admin-seeded skills with `createdBy=null`).
 */
async function resolveSessionOwner(sessionId) {
  const session = await db.trainingSession.findUnique({
    where:  { id: sessionId },
    select: { id: true, model: { select: { createdBy: true } } },
  })
  if (!session) return { exists: false, ownerId: null }
  return { exists: true, ownerId: session.model?.createdBy ?? null }
}

// ── POST /research/sessions/:sessionId/notes ───────────────────────────────
router.post('/sessions/:sessionId/notes', requireAuth, async (req, res) => {
  const { sessionId } = req.params
  const parsed = CreateBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', detail: parsed.error.issues })
  }
  if (byteLen(parsed.data.body) > MAX_BODY_BYTES) {
    return res.status(400).json({ error: 'body_too_large', limitBytes: MAX_BODY_BYTES })
  }

  try {
    const owner = await resolveSessionOwner(sessionId)
    if (!owner.exists) return res.status(404).json({ error: 'session_not_found' })
    if (owner.ownerId !== req.auth.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const note = await db.trainingSessionNote.create({
      data: {
        userId:    req.auth.userId,
        sessionId,
        body:      parsed.data.body,
        outcome:   parsed.data.outcome,
        tags:      normalizeTags(parsed.data.tags),
      },
    })
    return res.status(201).json({ note })
  } catch (err) {
    logger.error({ err: err.message, sessionId, userId: req.auth.userId }, 'research.create failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

// ── PATCH /research/notes/:noteId ──────────────────────────────────────────
router.patch('/notes/:noteId', requireAuth, async (req, res) => {
  const { noteId } = req.params
  const parsed = PatchBodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', detail: parsed.error.issues })
  }
  if (parsed.data.body !== undefined && byteLen(parsed.data.body) > MAX_BODY_BYTES) {
    return res.status(400).json({ error: 'body_too_large', limitBytes: MAX_BODY_BYTES })
  }

  try {
    const existing = await db.trainingSessionNote.findUnique({ where: { id: noteId } })
    if (!existing) return res.status(404).json({ error: 'note_not_found' })
    if (existing.userId !== req.auth.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }

    const data = {}
    if (parsed.data.body    !== undefined) data.body    = parsed.data.body
    if (parsed.data.outcome !== undefined) data.outcome = parsed.data.outcome
    if (parsed.data.tags    !== undefined) data.tags    = normalizeTags(parsed.data.tags)

    const note = await db.trainingSessionNote.update({ where: { id: noteId }, data })
    return res.json({ note })
  } catch (err) {
    logger.error({ err: err.message, noteId, userId: req.auth.userId }, 'research.update failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

// ── DELETE /research/notes/:noteId ─────────────────────────────────────────
router.delete('/notes/:noteId', requireAuth, async (req, res) => {
  const { noteId } = req.params
  try {
    const existing = await db.trainingSessionNote.findUnique({ where: { id: noteId } })
    if (!existing) return res.status(404).json({ error: 'note_not_found' })
    if (existing.userId !== req.auth.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }
    await db.trainingSessionNote.delete({ where: { id: noteId } })
    return res.json({ ok: true })
  } catch (err) {
    logger.error({ err: err.message, noteId, userId: req.auth.userId }, 'research.delete failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

// ── GET /research/notes ────────────────────────────────────────────────────
router.get('/notes', requireAuth, async (req, res) => {
  const parsed = ListQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', detail: parsed.error.issues })
  }
  const { outcome, tag, since, limit } = parsed.data
  const where = { userId: req.auth.userId }
  if (outcome) where.outcome  = outcome
  if (tag)     where.tags     = { has: tag.toLowerCase() }
  if (since)   where.createdAt = { gte: new Date(since) }

  try {
    const notes = await db.trainingSessionNote.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    limit ?? 50,
    })
    return res.json({ notes })
  } catch (err) {
    logger.error({ err: err.message, userId: req.auth.userId }, 'research.list failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

// ── GET /research/notes/:noteId ────────────────────────────────────────────
router.get('/notes/:noteId', requireAuth, async (req, res) => {
  const { noteId } = req.params
  try {
    const note = await db.trainingSessionNote.findUnique({ where: { id: noteId } })
    if (!note) return res.status(404).json({ error: 'note_not_found' })
    if (note.userId !== req.auth.userId && !note.sharedWithCommunity) {
      return res.status(403).json({ error: 'forbidden' })
    }
    return res.json({ note })
  } catch (err) {
    logger.error({ err: err.message, noteId, userId: req.auth.userId }, 'research.get failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

export default router
