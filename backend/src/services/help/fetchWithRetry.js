// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * fetchWithRetry — small wrapper around global fetch that transparently
 * retries on transient errors. Shared by embedClient and chatClient so the
 * Help System tolerates short-lived DNS / TCP flakes (EAI_AGAIN,
 * ECONNRESET, ENOTFOUND, ETIMEDOUT) and 5xx responses without falling
 * over.
 *
 * Why we need this (incident note 2026-05-13): both Docker's embedded DNS
 * (127.0.0.11 in the dev container) and macOS's mDNSResponder
 * intermittently emit EAI_AGAIN under burst load. Node's built-in fetch
 * (undici) does not retry on these; a single hiccup turns into a hard
 * `fetch failed` for the user. Fly.io's DNS is more reliable but not
 * immune — DNS is never 100%. The OpenAI SDK and most production HTTP
 * clients implement equivalent retry-on-transient logic; this matches
 * that posture.
 *
 * Design:
 *   - Retries TRANSIENT_FETCH_CODES and HTTP 5xx (and 429 if `retryOn429`
 *     is true — disabled by default since 429 deserves caller-level
 *     RateLimitError handling).
 *   - Does NOT retry on 4xx other than 429 (those are caller errors).
 *   - Does NOT retry on AbortError (caller cancelled).
 *   - Exponential backoff: 250 ms → 500 ms → 1000 ms (3 retries → 4 total
 *     attempts). Total worst-case wait: ~1.75 s + 4× per-request timeout.
 *   - Adds a per-attempt 30 s `AbortSignal.timeout` so a stuck connection
 *     can't hang the caller.
 *   - Preserves the original error/Response on the final failure (caller
 *     sees the same shape as raw fetch).
 */

import logger from '../../logger.js'

const TRANSIENT_FETCH_CODES = new Set([
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
])

// Budget: 2 retries (3 attempts), 250→500 ms backoff, 10 s per-try cap.
// Worst-case wall clock on a hard-down dependency: ~31 s (3 × 10 s timeouts
// + 750 ms backoff sleeps). Tuned down from the original 3 retries × 30 s
// after observing that a genuinely-broken local DNS makes 90 s of retries
// feel like the request "hangs" — at that point we want the caller to see
// the failure quickly so the degraded path can kick in (FTS fallback for
// embed; llm_unavailable for chat).
const DEFAULT_MAX_RETRIES   = 2
const DEFAULT_BACKOFF_BASE  = 250
const DEFAULT_PER_TRY_TIMEOUT = 10_000

function isTransientFetchError(err) {
  if (!err || typeof err !== 'object') return false
  if (err.name === 'AbortError') return false
  // undici wraps the real cause; check both layers.
  const code = err.cause?.code ?? err.code
  if (code && TRANSIENT_FETCH_CODES.has(code)) return true
  // undici sometimes surfaces just a `message` like "fetch failed" with no
  // code on certain DNS failure paths. Treat that as transient too — the
  // retry is cheap and the alternative is a hard fail.
  if (err.message === 'fetch failed' && !err.cause) return true
  return false
}

function shouldRetryStatus(status, { retryOn429 }) {
  if (status >= 500 && status <= 599) return true
  if (retryOn429 && status === 429)   return true
  return false
}

async function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
    }
  })
}

/**
 * Fetch with transparent retry on transient network errors and HTTP 5xx.
 *
 * @param {string|URL} url
 * @param {RequestInit} init
 * @param {object} [opts]
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.backoffBaseMs=250]
 * @param {number} [opts.perTryTimeoutMs=30000]
 * @param {boolean} [opts.retryOn429=false]
 * @param {string}  [opts.context]  — short tag for logs ("openai embed", etc.)
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, init = {}, opts = {}) {
  const maxRetries    = opts.maxRetries    ?? DEFAULT_MAX_RETRIES
  const backoffBaseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE
  const perTryTimeoutMs = opts.perTryTimeoutMs ?? DEFAULT_PER_TRY_TIMEOUT
  const retryOn429    = opts.retryOn429    ?? false
  const context       = opts.context       ?? 'fetch'

  let lastErr
  let lastResponse
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const perTryAc = new AbortController()
    const timer    = setTimeout(() => perTryAc.abort(), perTryTimeoutMs)
    // Compose caller's signal with our per-try timeout so external cancels
    // also reach the in-flight request.
    if (init.signal) {
      init.signal.addEventListener('abort', () => perTryAc.abort(), { once: true })
    }
    try {
      const res = await fetch(url, { ...init, signal: perTryAc.signal })
      clearTimeout(timer)

      if (res.ok || !shouldRetryStatus(res.status, { retryOn429 })) {
        return res
      }
      lastResponse = res
      lastErr = new Error(`${context}: HTTP ${res.status}`)
      // Falls through to the retry-or-give-up branch below.
    } catch (err) {
      clearTimeout(timer)
      if (err?.name === 'AbortError' && init.signal?.aborted) {
        // Caller cancelled. Don't retry.
        throw err
      }
      lastErr = err
      if (!isTransientFetchError(err)) throw err
    }

    if (attempt < maxRetries) {
      const waitMs = backoffBaseMs * (2 ** attempt)
      logger.warn(
        { context, attempt: attempt + 1, of: maxRetries + 1, waitMs, err: lastErr?.message?.slice(0, 120) },
        'fetchWithRetry: transient failure — retrying',
      )
      try { await sleep(waitMs, init.signal) }
      catch (abortErr) { throw abortErr }
    }
  }

  if (lastResponse) return lastResponse  // give caller the final non-2xx Response
  throw lastErr
}
