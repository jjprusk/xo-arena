// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * helpStore — client-side state for the Help System Guide drawer
 * (Sprint 3 §3.4 of doc/Help_System_Sprint_Tracker.md).
 *
 * Holds the current thread (an ordered list of Q&A turns) and exposes three
 * actions:
 *   - sendQuestion({ question, context }) — opens an SSE stream to
 *     `POST /api/v1/help/ask`, appends tokens as they arrive, finalises on
 *     the terminal `done` or `error` frame.
 *   - submitFeedback({ queryId, answerId, ... }) — POSTs to
 *     `/api/v1/help/feedback` (endpoint lands in §3.6). Test-injectable so
 *     §3.4 ships green without the endpoint live.
 *   - clearThread() — empties the thread.
 *
 * Persistence: thread is mirrored to `sessionStorage` so a refresh inside
 * the same browser session preserves the Q&A history. A new tab / session
 * starts empty (correct: questions are context-bound to where you were).
 * Rehydration carefully demotes any persisted turn left in a non-terminal
 * state to `status='error'` — a stream from a prior page lifetime can't
 * resume, so the user sees "(answer was interrupted)" instead of a
 * spinner that never resolves.
 *
 * Concurrency: one in-flight question at a time. While streaming, the
 * `inFlightTurnId` field is set; `sendQuestion` is a no-op if anything is
 * in flight. UI is expected to disable the input while `inFlightTurnId`
 * is non-null (Sprint 3 §3.1's "Disabled state when streaming").
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { streamHelpAsk } from '../lib/helpSse.js'

// Status values for a turn. Persisted; new values need a migration.
export const TURN_STATUS = Object.freeze({
  PENDING:   'pending',    // request issued, no token yet
  STREAMING: 'streaming',  // ≥1 token received
  DONE:      'done',       // terminal done frame received
  ERROR:     'error',      // terminal error frame OR transport failure
})

const NON_TERMINAL = new Set([TURN_STATUS.PENDING, TURN_STATUS.STREAMING])

function newTurnId() {
  // crypto.randomUUID() is available in modern browsers + jsdom. Fall back
  // to a timestamp+random combo for older environments (tests).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `turn-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function emptyTurn({ question }) {
  return {
    id:                     newTurnId(),
    question,
    status:                 TURN_STATUS.PENDING,
    partial:                '',
    rendered:               null,
    queryId:                null,
    answerId:               null,
    contentFilterTriggered: false,
    degraded:               false,
    latencyMs:              null,
    error:                  null,
    retryAfter:             null,
    startedAt:              Date.now(),
    finishedAt:             null,
  }
}

const BASE = import.meta.env?.VITE_API_URL ?? ''

/**
 * Default feedback poster. Production callers and the §3.6 endpoint will
 * pick this up automatically. Tests inject a mock via the `_feedbackPoster`
 * action argument or via `setFeedbackPoster()`.
 */
async function defaultFeedbackPoster({ queryId, answerId, signal, category, comment, implicit }, { token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}/api/v1/help/feedback`, {
    method: 'POST',
    headers,
    body:   JSON.stringify({ queryId, answerId, signal, category, comment, implicit }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || `feedback http ${res.status}`), {
      status: res.status,
    })
  }
  if (res.status === 204) return null
  return res.json()
}

/**
 * Default feedback loader. GETs the authed user's existing feedback row
 * for a (queryId, answerId) pair, returning the row or null. The §3.3
 * UI calls this on mount so it can reflect prior thumb/category/comment
 * state without forcing the user to redo their click.
 */
async function defaultFeedbackLoader({ queryId, answerId }, { token } = {}) {
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  const url = `${BASE}/api/v1/help/feedback?queryId=${encodeURIComponent(queryId)}&answerId=${encodeURIComponent(answerId)}`
  const res = await fetch(url, { method: 'GET', headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || `feedback GET http ${res.status}`), {
      status: res.status,
    })
  }
  const body = await res.json()
  return body?.feedback ?? null
}

/**
 * Build the zustand creator. Exported separately so tests can construct a
 * fresh store per test without polluting module state.
 *
 * @param {object} [deps]
 * @param {function} [deps.streamer]         — overrides streamHelpAsk
 * @param {function} [deps.feedbackPoster]   — overrides defaultFeedbackPoster
 */
export function createHelpStoreImpl(deps = {}) {
  const streamer        = deps.streamer        ?? streamHelpAsk
  const feedbackPoster  = deps.feedbackPoster  ?? defaultFeedbackPoster
  const feedbackLoader  = deps.feedbackLoader  ?? defaultFeedbackLoader

  return (set, get) => ({
    thread:           [],
    inFlightTurnId:   null,
    // Non-persisted: AbortController for the active stream. Kept on the
    // state object only so the abort action can find it; the persist
    // middleware's `partialize` strips it before write.
    _abortController: null,

    /**
     * Stream an answer for `question`. No-op (returns null) if there's
     * already a turn in flight — the UI is expected to gate via
     * `inFlightTurnId`, this is a defensive belt-and-braces guard.
     *
     * Sprint 3 §3.5 — if a previous turn finished within 60 seconds, fire
     * a fire-and-forget `submitFeedback({ implicit: { followUpWithin60s:
     * true } })` for it. The signal means "the user asked a follow-up
     * quickly, which often correlates with the prior answer being
     * incomplete". Errors are swallowed; the new question must not wait.
     *
     * Returns the new turn's id, or null if the call was rejected.
     */
    async sendQuestion({ question, context, token } = {}) {
      const trimmed = String(question ?? '').trim()
      if (!trimmed) return null
      if (get().inFlightTurnId) return null

      // §3.5 — emit followUpWithin60s for the prior turn if eligible.
      // We fire BEFORE creating the new turn (so the "prior" lookup is
      // unambiguous) but don't await — the implicit POST is telemetry,
      // not a precondition for the new question.
      const prior = get().thread[get().thread.length - 1]
      if (prior
          && prior.status === TURN_STATUS.DONE
          && prior.queryId
          && prior.answerId
          && prior.finishedAt
          && Date.now() - prior.finishedAt <= 60_000) {
        try {
          feedbackPoster(
            {
              queryId:  prior.queryId,
              answerId: prior.answerId,
              implicit: { followUpWithin60s: true },
            },
            { token },
          ).catch(() => {})
        } catch {}
      }

      const turn = emptyTurn({ question: trimmed })
      const abort = new AbortController()
      set(s => ({
        thread:           [...s.thread, turn],
        inFlightTurnId:   turn.id,
        _abortController: abort,
      }))

      try {
        for await (const frame of streamer({
          question: trimmed,
          context:  context ?? {},
          token,
          signal:   abort.signal,
        })) {
          if (frame.kind === 'token') {
            set(s => ({
              thread: s.thread.map(t => t.id === turn.id
                ? { ...t, status: TURN_STATUS.STREAMING, partial: t.partial + frame.text }
                : t),
            }))
          } else if (frame.kind === 'done') {
            set(s => ({
              thread: s.thread.map(t => t.id === turn.id
                ? {
                    ...t,
                    status:                 TURN_STATUS.DONE,
                    // The server's post-filter+link-rewrite `rendered` is
                    // the source of truth; if for any reason the done
                    // frame is missing it, fall back to what streamed.
                    rendered:               frame.rendered ?? t.partial,
                    queryId:                frame.queryId,
                    answerId:               frame.answerId,
                    contentFilterTriggered: frame.contentFilterTriggered,
                    degraded:               frame.degraded,
                    latencyMs:              frame.latencyMs,
                    citations:              frame.citations ?? [],
                    finishedAt:             Date.now(),
                  }
                : t),
              inFlightTurnId:   null,
              _abortController: null,
            }))
          } else if (frame.kind === 'error') {
            set(s => ({
              thread: s.thread.map(t => t.id === turn.id
                ? {
                    ...t,
                    status:     TURN_STATUS.ERROR,
                    error:      frame.error,
                    retryAfter: frame.retryAfter ?? null,
                    finishedAt: Date.now(),
                  }
                : t),
              inFlightTurnId:   null,
              _abortController: null,
            }))
          }
        }
      } catch (err) {
        // Should be rare — streamHelpAsk converts most errors into frames.
        // This catches a generator that throws synchronously or something
        // unexpected in the loop body.
        set(s => ({
          thread: s.thread.map(t => t.id === turn.id
            ? {
                ...t,
                status:     TURN_STATUS.ERROR,
                error:      'internal',
                finishedAt: Date.now(),
              }
            : t),
          inFlightTurnId:   null,
          _abortController: null,
        }))
        return turn.id
      }

      return turn.id
    },

    /**
     * Abort the in-flight stream, if any. The turn lands in `error` with
     * `error='aborted'` — the UI can show "stopped" with a retry option.
     */
    cancelInFlight() {
      const ac = get()._abortController
      if (ac) {
        try { ac.abort() } catch {}
      }
    },

    /**
     * POST feedback for a (queryId, answerId) turn. Returns the parsed
     * response (typically the upserted row) or throws.
     *
     * @param {object} args
     * @param {string} args.queryId
     * @param {string} args.answerId
     * @param {'HELPFUL'|'NOT_HELPFUL'} [args.signal]
     * @param {'OFF_TOPIC'|'OUTDATED'|'WRONG'|'INCOMPLETE'} [args.category]
     * @param {string} [args.comment]
     * @param {object} [args.implicit]  — e.g., { followUpWithin60s: true, docLinkClicked: true }
     * @param {string} [args.token]     — Bearer token
     */
    async submitFeedback(args) {
      return feedbackPoster(
        {
          queryId:  args.queryId,
          answerId: args.answerId,
          signal:   args.signal,
          category: args.category,
          comment:  args.comment,
          implicit: args.implicit,
        },
        { token: args.token },
      )
    },

    /**
     * GET the authed user's existing feedback row for a (queryId, answerId).
     * Returns the row or null. Used by §3.3's HelpFeedback component on
     * mount so the thumbs reflect prior state.
     */
    async loadFeedback({ queryId, answerId, token } = {}) {
      return feedbackLoader({ queryId, answerId }, { token })
    },

    clearThread() {
      // Abort any in-flight stream before discarding state — otherwise the
      // stream would keep running and write into a turn that's been
      // removed (harmless, but noisy in tests + dev tools).
      const ac = get()._abortController
      if (ac) {
        try { ac.abort() } catch {}
      }
      set({ thread: [], inFlightTurnId: null, _abortController: null })
    },
  })
}

/**
 * `safeSessionStorage` — sessionStorage isn't always available (SSR,
 * private-mode browsers that throw, jsdom test instances where window
 * is reset between tests). When the real storage is missing or throws,
 * we substitute a no-op stub so the persist middleware never crashes
 * the store on setState/getItem.
 *
 * Production behaviour is unchanged: in a real browser window the
 * native `window.sessionStorage` is returned and the persist round-trip
 * works exactly as before.
 */
const NOOP_STORAGE = {
  getItem:    () => null,
  setItem:    () => {},
  removeItem: () => {},
}
const safeSessionStorage = () => {
  if (typeof window === 'undefined') return NOOP_STORAGE
  try {
    const s = window.sessionStorage
    if (!s) return NOOP_STORAGE
    // Probe for private-mode browsers that expose sessionStorage but
    // throw on write.
    const probeKey = '__xo_help_probe__'
    s.setItem(probeKey, '1')
    s.removeItem(probeKey)
    return s
  } catch {
    return NOOP_STORAGE
  }
}

/**
 * Demote any persisted non-terminal turn to `error` on rehydrate — a stream
 * from a prior page lifetime can't be resumed.
 */
function reviveThread(thread) {
  if (!Array.isArray(thread)) return []
  return thread.map(t => {
    if (NON_TERMINAL.has(t.status)) {
      return {
        ...t,
        status:     TURN_STATUS.ERROR,
        error:      'interrupted',
        finishedAt: t.finishedAt ?? Date.now(),
      }
    }
    return t
  })
}

export const useHelpStore = create(
  persist(
    createHelpStoreImpl(),
    {
      name:    'xo-help-thread',
      version: 1,
      storage: createJSONStorage(safeSessionStorage),
      // Persist only the thread — not actions, not the abort controller,
      // not the in-flight pointer. inFlightTurnId is always null on
      // rehydrate because the stream definitely isn't.
      partialize: (state) => ({ thread: state.thread }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.thread         = reviveThread(state.thread)
          state.inFlightTurnId = null
        }
      },
    },
  ),
)

// Re-exported for tests that want to construct an unpersisted store with
// injected dependencies.
export { reviveThread }
