// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Streaming client for `POST /api/v1/help/ask`.
 *
 * The backend emits SSE frames (`event: <name>\ndata: <json>\n\n`) with three
 * event types: `token`, `done`, `error`. This module exposes an async
 * generator that yields normalised frames so callers (helpStore) don't have
 * to deal with SSE parsing.
 *
 * Why a separate module from helpStore: SSE parsing and state management are
 * orthogonal concerns. Splitting them keeps each piece small, and the
 * generator can be unit-tested with a hand-built fetch mock without dragging
 * zustand or sessionStorage into the test setup.
 *
 * Output frame shape:
 *   { kind: 'token', text }
 *   { kind: 'done',  answerId, queryId, rendered, contentFilterTriggered, degraded, latencyMs }
 *   { kind: 'error', error, retryAfter?, source?, status?, detail? }
 *
 * Error frames are normal terminal frames — the generator yields one and
 * returns. A thrown exception only happens for an unrecoverable transport
 * problem (e.g., the AbortSignal fired and we want the caller to know).
 *
 * Auth: callers pass a Bearer token. Guest requests will get a 401 from the
 * backend, which we surface as a final `{ kind: 'error', error: 'auth_required' }`
 * frame so the UI can route to "sign in to ask Guide" without a thrown
 * exception breaking the calling component.
 */

const BASE = import.meta.env?.VITE_API_URL ?? ''

/**
 * Parse a single SSE "event block" (text separated by a blank line) into a
 * { event, data } object. Returns null for blocks we can't make sense of.
 */
function parseSseBlock(block) {
  let event = null
  let dataParts = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) dataParts.push(line.slice(6))
  }
  if (!event && dataParts.length === 0) return null
  let data = null
  if (dataParts.length > 0) {
    const raw = dataParts.join('\n')
    try { data = JSON.parse(raw) }
    catch { data = { _raw: raw } }
  }
  return { event, data }
}

/**
 * Stream answer frames from `POST /api/v1/help/ask`.
 *
 * @param {object} args
 * @param {string} args.question
 * @param {object} [args.context]
 * @param {string} [args.token]    Bearer token; omitted for CLI-secret callers
 * @param {string} [args.internalSecret]  X-Internal-Secret (CLI/test only)
 * @param {AbortSignal} [args.signal]
 * @param {typeof fetch} [args.fetcher]  injectable for tests; defaults to global fetch
 * @param {string} [args.baseUrl]  override BASE; tests use this for clarity
 *
 * @yields { kind, ... } per the file header. Generator returns after one
 * terminal frame (`done` or `error`).
 */
export async function* streamHelpAsk({
  question,
  context  = {},
  token,
  internalSecret,
  signal,
  fetcher  = (typeof fetch !== 'undefined' ? fetch : null),
  baseUrl  = BASE,
} = {}) {
  if (typeof question !== 'string' || question.trim().length === 0) {
    yield { kind: 'error', error: 'empty_question' }
    return
  }
  if (typeof fetcher !== 'function') {
    yield { kind: 'error', error: 'no_fetch' }
    return
  }

  const headers = { 'Content-Type': 'application/json' }
  if (token)          headers['Authorization']    = `Bearer ${token}`
  if (internalSecret) headers['X-Internal-Secret'] = internalSecret

  let res
  try {
    res = await fetcher(`${baseUrl}/api/v1/help/ask`, {
      method: 'POST',
      headers,
      body:   JSON.stringify({ question, context }),
      signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      yield { kind: 'error', error: 'aborted' }
      return
    }
    yield { kind: 'error', error: 'network', detail: String(err?.message ?? err) }
    return
  }

  // 401 → auth_required terminal frame (no body to parse reliably).
  if (res.status === 401) {
    yield { kind: 'error', error: 'auth_required', status: 401 }
    return
  }
  // 429 from the app-level limiter (§2.5). Body shape:
  // { error: 'rate_limited', retryAfter: <s>, scope: 'minute'|'day' }
  if (res.status === 429) {
    let body = null
    try { body = await res.json() } catch {}
    yield {
      kind:       'error',
      error:      'rate_limited',
      source:     'app',
      retryAfter: body?.retryAfter ?? null,
      scope:      body?.scope ?? null,
      status:     429,
    }
    return
  }
  // 400 → validation problem; surface to caller so UI can render a hint.
  if (res.status === 400) {
    let body = null
    try { body = await res.json() } catch {}
    yield { kind: 'error', error: 'invalid_request', status: 400, detail: body }
    return
  }
  if (!res.ok || !res.body) {
    yield { kind: 'error', error: 'http_' + res.status, status: res.status }
    return
  }

  const reader  = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let sawTerminal = false

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE frames are separated by a blank line. We split on the
      // boundary, keep any partial trailing block in the buffer for the
      // next iteration.
      let idx
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const parsed = parseSseBlock(block)
        if (!parsed || !parsed.event) continue
        if (parsed.event === 'token') {
          yield { kind: 'token', text: String(parsed.data?.text ?? '') }
        } else if (parsed.event === 'done') {
          sawTerminal = true
          yield {
            kind:                   'done',
            answerId:               parsed.data?.answerId ?? null,
            queryId:                parsed.data?.queryId ?? null,
            rendered:               parsed.data?.rendered ?? '',
            contentFilterTriggered: !!parsed.data?.contentFilterTriggered,
            degraded:               !!parsed.data?.degraded,
            latencyMs:              parsed.data?.latencyMs ?? null,
          }
          return
        } else if (parsed.event === 'error') {
          sawTerminal = true
          // The backend's error frame echoes its `data` shape directly —
          // pass through with a normalised top-level shape.
          yield {
            kind:       'error',
            error:      parsed.data?.error ?? 'unknown',
            source:     parsed.data?.source ?? 'server',
            retryAfter: parsed.data?.retryAfter ?? null,
            detail:     parsed.data?.detail ?? null,
          }
          return
        }
        // Unknown event names are ignored on purpose — server may add new
        // event types later (e.g., 'progress') and we shouldn't crash on
        // them.
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      yield { kind: 'error', error: 'aborted' }
      return
    }
    yield { kind: 'error', error: 'stream_failed', detail: String(err?.message ?? err) }
    return
  } finally {
    try { reader.releaseLock?.() } catch {}
  }

  if (!sawTerminal) {
    // Server closed the stream without sending a done/error frame. Treat
    // as an internal-server bug; surface so the UI can render a generic
    // retry hint.
    yield { kind: 'error', error: 'incomplete_stream' }
  }
}
