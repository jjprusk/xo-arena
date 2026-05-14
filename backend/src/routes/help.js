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
import { requireAuth } from '../middleware/auth.js'
import logger from '../logger.js'
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
router.post('/ask', requireAuth, async (req, res, next) => {
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
  cleanedContext.journeyStep = await deriveJourneyStepTag(req.auth.userId)

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

export default router
