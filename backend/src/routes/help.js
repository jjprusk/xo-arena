// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /api/v1/help — user-facing Help System endpoints.
 *
 * Sprint 2 ships `POST /ask` (the RAG pipeline). The admin CRUD surface
 * lives at /api/v1/admin/help (helpAdmin.js); this router is for end-user
 * traffic that goes through the GuidePanel.
 *
 * Auth: v1 is authed-only (per §4.6 of doc/Help_System_Plan.md). Guests
 * see a "Sign in to ask" placeholder client-side; this route returns 401.
 *
 * Streaming: `/ask` emits SSE with three event types:
 *   - `event: token`  data: { text }           — per fragment
 *   - `event: done`   data: { answerId, ... }  — terminal happy frame
 *   - `event: error`  data: { error, ... }     — terminal failure frame
 *
 * Context allow-list enforcement (§4.5 of plan): the inbound `context`
 * blob is stripped to the schema below; unknown keys are silently dropped
 * and counted in a warn log. `journeyStep` is always derived server-side
 * — any client-supplied value is discarded.
 */

import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireAuthOrInternalSecret } from '../middleware/auth.js'
import { helpRateLimit } from '../middleware/helpRateLimit.js'
import logger from '../logger.js'
import db from '../lib/db.js'
import { ask } from '../services/help/helpService.js'
import { getJourneyProgress, deriveCurrentPhase } from '../services/journeyService.js'

const router = Router()

const ContextSchema = z.object({
  route:       z.string().min(1).max(200).optional(),
  currentSlot: z.string().min(1).max(50).optional(),
  sessionId:   z.string().uuid().optional(),
  gameType:    z.enum(['xo', 'pong']).optional(),
}).strip()

const AskBodySchema = z.object({
  question: z.string().min(1).max(1000),
  context:  z.any().optional(),
})

/**
 * Derive the server-canonical journey step for a user. Returns a stable
 * string token suitable for the prompt template:
 *   "hook" | "curriculum" | "specialize"
 * On any error, returns "(unknown)" so the prompt stays renderable.
 */
async function deriveJourneyStepTag(userId) {
  try {
    const progress = await getJourneyProgress(userId)
    return deriveCurrentPhase(progress?.completedSteps ?? [])
  } catch (err) {
    logger.warn({ err: err.message, userId }, 'help.ask: journey step derivation failed')
    return '(unknown)'
  }
}

/**
 * POST /api/v1/help/ask
 *
 * Body: { question: string, context?: { route, currentSlot, sessionId, gameType } }
 * Response: text/event-stream
 */
router.post('/ask', requireAuthOrInternalSecret, helpRateLimit(), async (req, res, next) => {
  const parse = AskBodySchema.safeParse(req.body)
  if (!parse.success) {
    return res.status(400).json({ error: 'invalid_request', detail: parse.error.flatten() })
  }
  const { question } = parse.data
  const rawContext = parse.data.context ?? {}

  // Strip context to the allow-list and log any unknown keys (signal of
  // stale clients or probing). `strip()` drops unknown keys silently; we
  // diff before/after to surface them in the log.
  const cleaned = ContextSchema.safeParse(rawContext)
  const cleanedContext = cleaned.success ? cleaned.data : {}
  if (rawContext && typeof rawContext === 'object') {
    const allowed = new Set(['route', 'currentSlot', 'sessionId', 'gameType'])
    const stripped = Object.keys(rawContext).filter(k => !allowed.has(k))
    if (stripped.length > 0) {
      logger.warn(
        { userId: req.auth?.userId, strippedKeys: stripped.slice(0, 10) },
        'help.ask: stripped unknown context keys',
      )
    }
  }

  // Always derive journeyStep server-side. Any client value is ignored.
  // CLI bypass callers don't have a real user → journey-step lookup would
  // miss; emit a stable '(cli)' tag so the prompt stays renderable.
  cleanedContext.journeyStep = req.auth.cliBypass
    ? '(cli)'
    : await deriveJourneyStepTag(req.auth.userId)

  // SSE plumbing.
  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',   // nginx / Fly: don't buffer
  })
  // Flush headers immediately so the client EventSource opens.
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  // Abort hook: cancel the upstream chat stream if the client disconnects.
  const abort = new AbortController()
  req.on('close', () => abort.abort())

  function sendEvent(name, data) {
    res.write(`event: ${name}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    let terminalSeen = false
    for await (const frame of ask({
      question,
      userId:  req.auth.userId,
      context: cleanedContext,
      signal:  abort.signal,
    })) {
      if (frame.kind === 'token') {
        sendEvent('token', { text: frame.text })
      } else if (frame.kind === 'done') {
        terminalSeen = true
        sendEvent('done', {
          answerId:                frame.answerId,
          queryId:                 frame.queryId,
          contentFilterTriggered:  frame.contentFilterTriggered,
          rendered:                frame.rendered,
          degraded:                frame.degraded,
          latencyMs:               frame.latencyMs,
        })
      } else if (frame.kind === 'error') {
        terminalSeen = true
        // Map service-level error codes to HTTP-flavored hints embedded in
        // the SSE error frame (the response itself is already 200 — SSE
        // does not support changing status mid-stream).
        sendEvent('error', frame)
      }
    }
    if (!terminalSeen) {
      sendEvent('error', { error: 'internal' })
    }
  } catch (err) {
    logger.error({ err: err.message, userId: req.auth?.userId }, 'help.ask: unhandled stream error')
    try { sendEvent('error', { error: 'internal' }) } catch {}
  } finally {
    res.end()
  }
})

// ── /feedback ────────────────────────────────────────────────────────────────
// Sprint 3 §3.6 of doc/Help_System_Sprint_Tracker.md. Upserts a HelpFeedback
// row keyed by (userId, queryId, answerId) — the schema unique constraint.
//
// Partial updates are allowed: e.g., the §3.5 implicit-signal POST sends
// only { implicit: { docLinkClicked: true } } with no signal/category/
// comment. We merge implicit (the json column) by shallow-extending the
// existing object so a doc-link-click doesn't wipe a prior signal-set.
//
// Behaviour per §3.3 spec: flipping to HELPFUL when the prior row was
// NOT_HELPFUL clears category + comment (the user is no longer providing
// negative context). Flipping the other way preserves any prior data so
// the user can add a category without re-typing.
//
// Auth: requireAuth (no CLI bypass — feedback always reflects a real user).

const SIGNAL    = ['HELPFUL', 'NOT_HELPFUL']
const CATEGORY  = ['OFF_TOPIC', 'OUTDATED', 'WRONG', 'INCOMPLETE']
const ALLOWED_IMPLICIT_KEYS = new Set(['docLinkClicked', 'followUpWithin60s', 'href'])

const FeedbackBodySchema = z.object({
  queryId:  z.string().min(1).max(64),
  answerId: z.string().min(1).max(64),
  signal:   z.enum(SIGNAL).nullable().optional(),
  category: z.enum(CATEGORY).nullable().optional(),
  comment:  z.string().max(2000).nullable().optional(),
  implicit: z.record(z.string(), z.any()).optional(),
})

function sanitiseImplicit(raw) {
  if (raw == null || typeof raw !== 'object') return null
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_IMPLICIT_KEYS.has(k)) continue
    // Coerce simple values; ignore arrays/objects to keep the column tidy.
    if (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') {
      out[k] = v
    }
  }
  return out
}

/**
 * POST /api/v1/help/feedback
 *
 * Body: { queryId, answerId, signal?, category?, comment?, implicit? }
 * Response: 200 { feedback: { id, signal, category, comment, implicit, ... } }
 */
router.post('/feedback', requireAuth, async (req, res, next) => {
  const parse = FeedbackBodySchema.safeParse(req.body)
  if (!parse.success) {
    return res.status(400).json({ error: 'invalid_request', detail: parse.error.flatten() })
  }
  const userId = req.auth.userId
  const { queryId, answerId, signal, category, comment } = parse.data
  const implicitPatch = sanitiseImplicit(parse.data.implicit)

  // Defensive: log if we stripped unknown implicit keys — same pattern as
  // the /ask context allow-list.
  if (parse.data.implicit && typeof parse.data.implicit === 'object') {
    const stripped = Object.keys(parse.data.implicit).filter(k => !ALLOWED_IMPLICIT_KEYS.has(k))
    if (stripped.length > 0) {
      logger.warn({ userId, strippedKeys: stripped.slice(0, 10) },
        'help.feedback: stripped unknown implicit keys')
    }
  }

  try {
    // Load existing so we can implement the §3.3 flip rule + merge implicit.
    const existing = await db.helpFeedback.findUnique({
      where: { userId_queryId_answerId: { userId, queryId, answerId } },
    })

    // Compute the next-state field set. Undefined fields in the body are
    // "don't change" (partial update); null is "explicit clear".
    let nextSignal   = existing?.signal   ?? null
    let nextCategory = existing?.category ?? null
    let nextComment  = existing?.comment  ?? null
    let nextImplicit = (existing?.implicit && typeof existing.implicit === 'object')
      ? { ...existing.implicit }
      : {}

    if (signal !== undefined) {
      const priorWasNotHelpful = nextSignal === 'NOT_HELPFUL'
      nextSignal = signal
      // §3.3 flip rule: HELPFUL after NOT_HELPFUL clears category + comment.
      if (signal === 'HELPFUL' && priorWasNotHelpful) {
        nextCategory = null
        nextComment  = null
      }
    }
    if (category !== undefined) nextCategory = category
    if (comment  !== undefined) nextComment  = comment
    if (implicitPatch !== null) {
      nextImplicit = { ...nextImplicit, ...implicitPatch }
    }

    const row = existing
      ? await db.helpFeedback.update({
          where: { userId_queryId_answerId: { userId, queryId, answerId } },
          data:  {
            signal:   nextSignal,
            category: nextCategory,
            comment:  nextComment,
            implicit: nextImplicit,
          },
        })
      : await db.helpFeedback.create({
          data: {
            userId, queryId, answerId,
            signal:   nextSignal,
            category: nextCategory,
            comment:  nextComment,
            implicit: nextImplicit,
          },
        })

    return res.json({ feedback: row })
  } catch (err) {
    // Foreign-key violation (queryId/answerId not real) → 404
    if (err?.code === 'P2003') {
      return res.status(404).json({ error: 'unknown_query_or_answer' })
    }
    logger.error({ err: err.message, userId }, 'help.feedback: failed')
    return res.status(500).json({ error: 'internal' })
  }
})

/**
 * GET /api/v1/help/feedback?queryId=&answerId=
 *
 * Returns the authed user's existing feedback row for the given pair, or
 * null if none. Used by §3.3's HelpFeedback component on first render.
 */
router.get('/feedback', requireAuth, async (req, res, next) => {
  const queryId  = String(req.query.queryId  ?? '')
  const answerId = String(req.query.answerId ?? '')
  if (!queryId || !answerId) {
    return res.status(400).json({ error: 'missing_query_params' })
  }
  try {
    const row = await db.helpFeedback.findUnique({
      where: { userId_queryId_answerId: { userId: req.auth.userId, queryId, answerId } },
    })
    return res.json({ feedback: row ?? null })
  } catch (err) {
    logger.error({ err: err.message, userId: req.auth.userId }, 'help.feedback GET: failed')
    return res.status(500).json({ error: 'internal' })
  }
})

// ── Public corpus browse (§3.7) ──────────────────────────────────────────────
// No auth: anyone can read PUBLISHED help docs. Admin-only docs
// (`admin_only: true` in frontmatter) are still gated by their
// HelpDoc.status — admin docs sit in a separate router (helpAdmin.js)
// and aren't exposed here.

/**
 * GET /api/v1/help/docs
 *
 * Returns published docs grouped by category. Trimmed shape — no body —
 * for fast listing. Bodies are fetched on-demand via `/docs/:slug`.
 */
router.get('/docs', async (req, res, next) => {
  try {
    const docs = await db.helpDoc.findMany({
      where:  { status: 'PUBLISHED' },
      select: {
        slug:     true,
        title:    true,
        category: true,
        tags:     true,
        updatedAt:true,
      },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    })
    return res.json({ docs })
  } catch (err) {
    logger.error({ err: err.message }, 'help.docs list: failed')
    return res.status(500).json({ error: 'internal' })
  }
})

/**
 * GET /api/v1/help/docs/:slug
 *
 * Returns the full body for a single published doc. 404 if the slug
 * doesn't exist or the doc isn't PUBLISHED (DRAFT/ARCHIVED hidden from
 * the public browse surface).
 */
router.get('/docs/:slug', async (req, res, next) => {
  const slug = String(req.params.slug ?? '').trim()
  if (!slug) return res.status(400).json({ error: 'invalid_slug' })
  try {
    const doc = await db.helpDoc.findUnique({
      where:  { slug },
      select: {
        slug:      true,
        title:     true,
        body:      true,
        category:  true,
        tags:      true,
        status:    true,
        updatedAt: true,
      },
    })
    if (!doc || doc.status !== 'PUBLISHED') {
      return res.status(404).json({ error: 'not_found' })
    }
    // Strip status from the response — clients only ever see PUBLISHED here.
    const { status, ...rest } = doc
    return res.json({ doc: rest })
  } catch (err) {
    logger.error({ err: err.message, slug }, 'help.docs get: failed')
    return res.status(500).json({ error: 'internal' })
  }
})

export default router
