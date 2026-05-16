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
import {
  publishNote,
  unpublishNote,
  publishEntry,
  unpublishEntry,
  PublishError,
} from '../services/research/publishService.js'
import {
  listCommunityDocs,
  buildExportMarkdown,
} from '../services/research/communityService.js'
import { researchPublishRateLimit } from '../middleware/researchPublishRateLimit.js'

const router = Router()

const MAX_BODY_BYTES = 2 * 1024 // 2 KB per plan §C4
const MAX_TAGS       = 10
const MAX_TAG_LEN    = 32
// Accept loose tag input; normalizeTags() lowercases and dedups.
const TAG_PATTERN    = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const NOTE_OUTCOMES  = ['SUCCESS', 'PLATEAU', 'REGRESSION', 'INCONCLUSIVE']

const MAX_ENTRY_BODY_BYTES = 4 * 1024 // 4 KB per plan §C4
const MAX_ENTRY_TITLE_LEN  = 120
const ENTRY_CATEGORIES = ['PLANNING', 'RETROSPECTIVE', 'OBSERVATION', 'OTHER']

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

const EntryCategorySchema = z.enum(ENTRY_CATEGORIES)

const CreateEntrySchema = z.object({
  title:    z.string().min(1).max(MAX_ENTRY_TITLE_LEN),
  body:     z.string().min(1),
  category: EntryCategorySchema,
  tags:     z.array(TagSchema).max(MAX_TAGS).optional(),
})

const PatchEntrySchema = z.object({
  title:    z.string().min(1).max(MAX_ENTRY_TITLE_LEN).optional(),
  body:     z.string().min(1).optional(),
  category: EntryCategorySchema.optional(),
  tags:     z.array(TagSchema).max(MAX_TAGS).optional(),
}).refine(
  obj => Object.keys(obj).length > 0,
  { message: 'at least one field must be provided' },
)

const ListEntriesQuerySchema = z.object({
  category: EntryCategorySchema.optional(),
  tag:      z.string().min(1).max(MAX_TAG_LEN).optional(),
  since:    z.string().datetime().optional(),
  limit:    z.coerce.number().int().min(1).max(200).optional(),
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

// ── ResearchLogEntry CRUD (Sprint 2 §2.2) ──────────────────────────────────
//
// Entries are free-form research-log entries (PLANNING / RETROSPECTIVE /
// OBSERVATION / OTHER) — distinct from notes, which are tied to a specific
// TrainingSession. Owner-only mutation; reads allow community-shared rows.

router.post('/entries', requireAuth, async (req, res) => {
  const parsed = CreateEntrySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', detail: parsed.error.issues })
  }
  if (byteLen(parsed.data.body) > MAX_ENTRY_BODY_BYTES) {
    return res.status(400).json({ error: 'body_too_large', limitBytes: MAX_ENTRY_BODY_BYTES })
  }
  try {
    const entry = await db.researchLogEntry.create({
      data: {
        userId:   req.auth.userId,
        title:    parsed.data.title,
        body:     parsed.data.body,
        category: parsed.data.category,
        tags:     normalizeTags(parsed.data.tags),
      },
    })
    return res.status(201).json({ entry })
  } catch (err) {
    logger.error({ err: err.message, userId: req.auth.userId }, 'research.entry.create failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

router.patch('/entries/:entryId', requireAuth, async (req, res) => {
  const { entryId } = req.params
  const parsed = PatchEntrySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', detail: parsed.error.issues })
  }
  if (parsed.data.body !== undefined && byteLen(parsed.data.body) > MAX_ENTRY_BODY_BYTES) {
    return res.status(400).json({ error: 'body_too_large', limitBytes: MAX_ENTRY_BODY_BYTES })
  }
  try {
    const existing = await db.researchLogEntry.findUnique({ where: { id: entryId } })
    if (!existing) return res.status(404).json({ error: 'entry_not_found' })
    if (existing.userId !== req.auth.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }
    const data = {}
    if (parsed.data.title    !== undefined) data.title    = parsed.data.title
    if (parsed.data.body     !== undefined) data.body     = parsed.data.body
    if (parsed.data.category !== undefined) data.category = parsed.data.category
    if (parsed.data.tags     !== undefined) data.tags     = normalizeTags(parsed.data.tags)
    const entry = await db.researchLogEntry.update({ where: { id: entryId }, data })
    return res.json({ entry })
  } catch (err) {
    logger.error({ err: err.message, entryId, userId: req.auth.userId }, 'research.entry.update failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

router.delete('/entries/:entryId', requireAuth, async (req, res) => {
  const { entryId } = req.params
  try {
    const existing = await db.researchLogEntry.findUnique({ where: { id: entryId } })
    if (!existing) return res.status(404).json({ error: 'entry_not_found' })
    if (existing.userId !== req.auth.userId) {
      return res.status(403).json({ error: 'forbidden' })
    }
    // If the entry was published, tear down the linked HelpDoc + chunks so
    // we don't leave an orphan in the community lane. Deletion must work
    // regardless of the publish flag's current state.
    if (existing.helpDocId) {
      await db.helpChunk.deleteMany({ where: { docId: existing.helpDocId } })
      await db.helpDoc.deleteMany({ where: { id: existing.helpDocId } })
    }
    await db.researchLogEntry.delete({ where: { id: entryId } })
    return res.json({ ok: true })
  } catch (err) {
    logger.error({ err: err.message, entryId, userId: req.auth.userId }, 'research.entry.delete failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

router.get('/entries', requireAuth, async (req, res) => {
  const parsed = ListEntriesQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', detail: parsed.error.issues })
  }
  const { category, tag, since, limit } = parsed.data
  const where = { userId: req.auth.userId }
  if (category) where.category   = category
  if (tag)      where.tags       = { has: tag.toLowerCase().replace(/-/g, '_') }
  if (since)    where.createdAt  = { gte: new Date(since) }
  try {
    const entries = await db.researchLogEntry.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    limit ?? 50,
    })
    return res.json({ entries })
  } catch (err) {
    logger.error({ err: err.message, userId: req.auth.userId }, 'research.entry.list failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

router.get('/entries/:entryId', requireAuth, async (req, res) => {
  const { entryId } = req.params
  try {
    const entry = await db.researchLogEntry.findUnique({ where: { id: entryId } })
    if (!entry) return res.status(404).json({ error: 'entry_not_found' })
    if (entry.userId !== req.auth.userId && !entry.sharedWithCommunity) {
      return res.status(403).json({ error: 'forbidden' })
    }
    return res.json({ entry })
  } catch (err) {
    logger.error({ err: err.message, entryId, userId: req.auth.userId }, 'research.entry.get failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

// ── Publish / unpublish (notes + entries) ──────────────────────────────────
//
// Sprint 2 of doc/Research_Log_Plan.md §2.2. All four routes are gated by
// `SystemConfig.researchLog.publishEnabled` inside the publishService; the
// surface 503s cleanly when the flag is OFF.

function sendPublishError(res, err, ctx) {
  if (err instanceof PublishError) {
    return res.status(err.status).json({ error: err.code, message: err.message })
  }
  logger.error({ err: err.message, ...ctx }, 'research.publish failed')
  return res.status(500).json({ error: 'internal_error' })
}

// ── Community feed + export (Sprint 2 §3 steps 5–6) ───────────────────────

const CommunityQuerySchema = z.object({
  tag:              z.string().min(1).max(MAX_TAG_LEN).optional(),
  limit:            z.coerce.number().int().min(1).max(100).optional(),
  cursorCreatedAt:  z.string().datetime().optional(),
  cursorId:         z.string().min(1).max(64).optional(),
}).refine(
  obj => (!!obj.cursorCreatedAt) === (!!obj.cursorId),
  { message: 'cursorCreatedAt and cursorId must be provided together' },
)

router.get('/community', requireAuth, async (req, res) => {
  const parsed = CommunityQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', detail: parsed.error.issues })
  }
  try {
    const result = await listCommunityDocs(parsed.data)
    return res.json(result)
  } catch (err) {
    logger.error({ err: err.message, userId: req.auth.userId }, 'research.community.list failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

router.get('/export.md', requireAuth, async (req, res) => {
  try {
    const md = await buildExportMarkdown(req.auth.userId)
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="training-journal.md"')
    return res.status(200).send(md)
  } catch (err) {
    logger.error({ err: err.message, userId: req.auth.userId }, 'research.export failed')
    return res.status(500).json({ error: 'internal_error' })
  }
})

router.post('/notes/:noteId/publish', requireAuth, researchPublishRateLimit(), async (req, res) => {
  try {
    const result = await publishNote(req.params.noteId, req.auth.userId)
    return res.status(200).json(result)
  } catch (err) {
    return sendPublishError(res, err, { noteId: req.params.noteId, userId: req.auth.userId })
  }
})

router.post('/notes/:noteId/unpublish', requireAuth, async (req, res) => {
  try {
    const result = await unpublishNote(req.params.noteId, req.auth.userId)
    return res.status(200).json(result)
  } catch (err) {
    return sendPublishError(res, err, { noteId: req.params.noteId, userId: req.auth.userId })
  }
})

router.post('/entries/:entryId/publish', requireAuth, researchPublishRateLimit(), async (req, res) => {
  try {
    const result = await publishEntry(req.params.entryId, req.auth.userId)
    return res.status(200).json(result)
  } catch (err) {
    return sendPublishError(res, err, { entryId: req.params.entryId, userId: req.auth.userId })
  }
})

router.post('/entries/:entryId/unpublish', requireAuth, async (req, res) => {
  try {
    const result = await unpublishEntry(req.params.entryId, req.auth.userId)
    return res.status(200).json(result)
  } catch (err) {
    return sendPublishError(res, err, { entryId: req.params.entryId, userId: req.auth.userId })
  }
})

export default router
