// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Chat-completion client for the Help System.
 *
 * Per ADR-001 (revised) in doc/Help_System_Plan.md, v1 uses OpenAI's
 * `gpt-4o-mini` as the sole external chat provider. The `chatClient`
 * boundary exists so we can swap to Groq (failover) or an `xo-llm` proxy
 * (full self-hosted, future) by flipping the `HELP_CHAT_PROVIDER` env var
 * — no caller changes.
 *
 * Two modes:
 *   - Stub: yields a canned response. Active under NODE_ENV=test or
 *     VITEST=true or HELP_CHAT_STUB=1. Lets `helpService.ask` tests run
 *     hermetically and lets the §2.4 adversarial fixtures pin
 *     plumbing-level behavior without paying real LLM tokens.
 *   - OpenAI: streams `gpt-4o-mini` via the chat-completions SSE API.
 *     Default in any environment where stub mode isn't active.
 *
 * Stream contract: `streamChatCompletion` is an async generator that
 * yields **plain content strings** (the `choices[0].delta.content` chunks
 * from OpenAI's SSE), not raw SSE frames. The caller is responsible for
 * accumulating and re-streaming.
 */

import logger from '../../logger.js'
import { RateLimitError } from './embedClient.js'

const OPENAI_CHAT_URL   = 'https://api.openai.com/v1/chat/completions'
const OPENAI_CHAT_MODEL = 'gpt-4o-mini'

/** Stable identifier used as `HelpQuery.modelVersion` / `HelpAnswer.modelVersion`. */
export const CHAT_MODEL_VERSION_LIVE = `openai:${OPENAI_CHAT_MODEL}`
export const CHAT_MODEL_VERSION_STUB = 'stub:chat'

/** Re-export for callers that already handle the embed RateLimitError. */
export { RateLimitError }

/** Provider id; 'openai' (default), 'groq' (failover stub), 'xo-llm' (future). */
export function currentChatProvider() {
  return process.env.HELP_CHAT_PROVIDER || 'openai'
}

function shouldUseStub() {
  return (
    process.env.NODE_ENV === 'test'
    || process.env.VITEST === 'true'
    || process.env.HELP_CHAT_STUB === '1'
  )
}

/**
 * Current model version tag this process would write into HelpQuery /
 * HelpAnswer rows. Live identity in production / dev; sentinel in tests.
 */
export function currentChatModelVersion() {
  return shouldUseStub() ? CHAT_MODEL_VERSION_STUB : CHAT_MODEL_VERSION_LIVE
}

/**
 * Async generator yielding successive content fragments from the chat
 * completion. Caller may accumulate them or re-stream to a client.
 *
 *   for await (const piece of streamChatCompletion(messages)) { ... }
 *
 * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
 * @param {object} [opts]
 * @param {number} [opts.maxTokens=400]
 * @param {AbortSignal} [opts.signal]
 *
 * Throws:
 *   - RateLimitError on 429 (with retryAfter when present)
 *   - Error('openai chat <status>: ...') on other non-2xx
 *   - Error('chat: OPENAI_API_KEY missing ...') when key absent in live mode
 *   - Error('chat: provider not built — <provider>') for 'groq' / 'xo-llm'
 */
export async function* streamChatCompletion(messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('streamChatCompletion: messages must be a non-empty array')
  }
  const maxTokens = opts.maxTokens ?? 400

  if (shouldUseStub()) {
    // Hermetic stub. Yields a deterministic short answer so tests can pin
    // plumbing behavior (accumulation, content-filter wiring, persistence)
    // without paying real LLM tokens. Tests that want specific output use
    // vi.spyOn(globalThis, 'fetch') in OpenAI mode instead.
    const stub = '[stub] Answer would stream here in production.'
    for (const chunk of stub.split(' ')) {
      yield chunk + ' '
    }
    return
  }

  const provider = currentChatProvider()
  if (provider !== 'openai') {
    // ADR-001 documents Groq and xo-llm as future failover paths. They are
    // intentionally not built in v1 — caller can wire them when the
    // migration trigger fires. Throw explicitly so a misconfigured env var
    // produces a clear error rather than silent OpenAI fallthrough.
    throw new Error(`chat: provider not built — ${provider}`)
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error(
      'chat: OPENAI_API_KEY missing — set it in env, ' +
      'or use HELP_CHAT_STUB=1 to bypass for offline/dev work',
    )
  }

  const res = await fetch(OPENAI_CHAT_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json',
      'Accept':        'text/event-stream',
    },
    body: JSON.stringify({
      model:       OPENAI_CHAT_MODEL,
      messages,
      max_tokens:  maxTokens,
      stream:      true,
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 429) {
      const ra = parseInt(res.headers.get('retry-after') ?? '0', 10)
      throw new RateLimitError(
        `openai chat 429: ${body.slice(0, 200)}`,
        Number.isFinite(ra) && ra > 0 ? ra : null,
      )
    }
    throw new Error(`openai chat ${res.status}: ${body.slice(0, 200)}`)
  }

  if (!res.body) {
    throw new Error('openai chat: response had no body to stream')
  }

  // OpenAI SSE frames are `data: { ... }\n\n` with a final `data: [DONE]`.
  // We parse incrementally: accumulate bytes, split on blank-line frame
  // boundaries, extract `choices[0].delta.content` from each JSON frame.
  const decoder = new TextDecoder()
  let pending = ''
  for await (const chunk of res.body) {
    pending += decoder.decode(chunk, { stream: true })
    let idx
    while ((idx = pending.indexOf('\n\n')) !== -1) {
      const frame = pending.slice(0, idx)
      pending = pending.slice(idx + 2)
      // A frame may be multiple `data:` lines; we only care about the
      // last data line (OpenAI uses one per frame).
      const line = frame.split('\n').find(l => l.startsWith('data:'))
      if (!line) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const j = JSON.parse(payload)
        const piece = j?.choices?.[0]?.delta?.content
        if (typeof piece === 'string' && piece.length > 0) yield piece
      } catch (err) {
        // Don't fail the whole stream over a malformed frame — log and skip.
        logger.warn({ err: err.message, payloadHead: payload.slice(0, 80) },
          'chat: failed to parse SSE frame; skipping')
      }
    }
  }
}

/**
 * Health probe — fires one minimal chat call (3-token response) and returns
 * a stable shape for the admin Health dashboard tile. Never throws; surfaces
 * failure via `ok: false` + `error`.
 */
export async function health() {
  if (shouldUseStub()) {
    return { ok: true, latencyMs: 0, model: 'stub', provider: 'stub' }
  }
  const t0 = Date.now()
  try {
    let pieces = 0
    for await (const _ of streamChatCompletion(
      [
        { role: 'system', content: 'You are a health check. Reply "ok".' },
        { role: 'user',   content: 'ping' },
      ],
      { maxTokens: 5 },
    )) {
      pieces++
      // Cap iteration just in case — the prompt asks for "ok" only.
      if (pieces > 20) break
    }
    return {
      ok:        pieces > 0,
      latencyMs: Date.now() - t0,
      model:     OPENAI_CHAT_MODEL,
      provider:  'openai',
    }
  } catch (err) {
    return {
      ok:        false,
      latencyMs: Date.now() - t0,
      model:     OPENAI_CHAT_MODEL,
      provider:  'openai',
      error:     String(err?.message ?? err).slice(0, 200),
    }
  }
}
