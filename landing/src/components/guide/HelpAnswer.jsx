// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * HelpAnswer — Sprint 3 §3.2 of doc/Help_System_Sprint_Tracker.md.
 *
 * Renders a single turn from helpStore: question + answer.
 *
 * Lifecycle by `status`:
 *   - pending   → "Thinking…" placeholder (no tokens yet)
 *   - streaming → Markdown of `partial` (live tokens as they arrive)
 *   - done      → Markdown of `rendered` (post-filter + link-rewrite)
 *   - error     → Friendly inline message keyed off `error` code
 *
 * Link tracking (§3.2 spec): every inline `<a>` in the rendered Markdown is
 * wired with a click handler that POSTs feedback `implicit.docLinkClicked`
 * (against the answer's queryId/answerId) before navigation continues. The
 * feedback endpoint lands in §3.6; until then, submitFeedback rejects
 * silently — we swallow the rejection so the click-through still
 * navigates. Once §3.6 ships, the click loop fires automatically.
 *
 * Internal links (`/foo`) use react-router so we stay in-SPA; external
 * URLs (`http(s)://…`) get `target="_blank" rel="noopener noreferrer"`.
 */

import React, { useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'
import { useHelpStore } from '../../store/helpStore.js'
import HelpFeedback from './HelpFeedback.jsx'

const ERROR_COPY = {
  auth_required:    'Sign in to ask Guide questions.',
  rate_limited_app: 'You have asked a lot of questions in a short time. Please wait a bit and try again.',
  rate_limited_provider: 'Guide is briefly rate-limited by the AI service. Please try again shortly.',
  llm_unavailable:  'Guide is having trouble reaching the AI service. Please try again.',
  aborted:          'Stopped.',
  interrupted:      '(This answer was interrupted.)',
  invalid_request:  'I could not process that question. Try rephrasing.',
  incomplete_stream: 'Connection lost mid-answer. Try again.',
  stream_failed:    'Connection lost mid-answer. Try again.',
  network:          'Network error. Check your connection and try again.',
  empty_question:   '',
  internal:         'Something went wrong. Try again.',
}

function errorMessage(turn) {
  if (turn.error === 'rate_limited') {
    // The store keeps the original frame's `error` ('rate_limited'); the
    // source/scope is not carried per-turn. Use retryAfter as the hint:
    // if it's small (<60s), assume the app limiter; otherwise treat as
    // a provider limit. Imperfect but practical until §3.5 adds richer
    // metadata.
    const ra = turn.retryAfter
    if (ra != null && ra <= 60) {
      return ERROR_COPY.rate_limited_app + (ra > 0 ? ` (retry in ${ra}s)` : '')
    }
    return ERROR_COPY.rate_limited_provider
  }
  return ERROR_COPY[turn.error] ?? ERROR_COPY.internal
}

/**
 * <a> replacement used inside <ReactMarkdown components={{ a: makeTrackedLink(turn) }} />.
 * We bind the turn's queryId/answerId at the component-factory level so
 * the rendered <a> doesn't have to look them up from context.
 */
function makeTrackedLink(turn) {
  return function TrackedLink({ href, children, ...rest }) {
    const submitFeedback = useHelpStore(s => s.submitFeedback)
    const onClick = useCallback((e) => {
      // Fire-and-forget. Errors (endpoint not built yet, network blip, etc.)
      // must not block navigation — the link still routes either way.
      if (turn.queryId && turn.answerId) {
        try {
          // No await — let the click-through proceed immediately.
          submitFeedback({
            queryId:  turn.queryId,
            answerId: turn.answerId,
            implicit: { docLinkClicked: true, href: href ?? '' },
          }).catch(() => {})
        } catch {}
      }
      // Do not preventDefault — let the browser / router handle it.
      // The standard <a> click is fine for external URLs; for internal
      // paths we render <Link>, whose own onClick eats the default and
      // does react-router navigation.
      if (rest.onClick) rest.onClick(e)
    }, [submitFeedback])

    const href_ = href ?? ''
    const isInternal = href_.startsWith('/') && !href_.startsWith('//')
    if (isInternal) {
      return (
        <Link to={href_} onClick={onClick} {...rest}>
          {children}
        </Link>
      )
    }
    return (
      <a
        href={href_}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        {...rest}
      >
        {children}
      </a>
    )
  }
}

export default function HelpAnswer({ turn, innerRef = null }) {
  const { status, question, partial, rendered, error } = turn

  // Compose the body text per status — react-markdown handles empty
  // strings fine.
  const text =
    status === 'done'      ? (rendered ?? partial ?? '')
    : status === 'streaming' ? (partial ?? '')
    : ''

  const trackedLink = makeTrackedLink(turn)

  return (
    <div
      ref={innerRef}
      data-turn-id={turn.id}
      className="flex flex-col gap-2 rounded-lg p-3"
      style={{
        background: 'var(--bg-surface-2)',
        border: '1px solid var(--border-default)',
      }}
    >
      {/* User's question */}
      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {question}
      </div>

      {/* Answer body — depends on status */}
      {status === 'pending' && (
        <div className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
          Thinking…
        </div>
      )}

      {(status === 'streaming' || status === 'done') && (
        <div
          className="help-answer-md text-sm"
          style={{ color: 'var(--text-primary)' }}
          data-testid="help-answer-body"
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ a: trackedLink }}
          >
            {text}
          </ReactMarkdown>
          {status === 'streaming' && (
            <span
              aria-hidden="true"
              className="inline-block animate-pulse"
              style={{ marginLeft: 2, color: 'var(--text-muted)' }}
            >
              ▍
            </span>
          )}
        </div>
      )}

      {status === 'error' && (
        <div
          className="text-sm"
          style={{ color: 'var(--text-muted)' }}
          data-testid="help-answer-error"
        >
          {errorMessage(turn)}
        </div>
      )}

      {/* Degraded-mode hint (non-blocking; just a footnote) */}
      {status === 'done' && turn.degraded && (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          (Answered with limited search — embedding service was briefly unavailable.)
        </div>
      )}

      {/* Lane-tagged citations (Research_Log_Plan Sprint 3 §3 step 4 + 6) */}
      {status === 'done' && Array.isArray(turn.citations) && turn.citations.length > 0 && (
        <CitationsList citations={turn.citations} />
      )}

      {/* Sprint 3 §3.3 — thumbs + categories + comment. HelpFeedback
          renders nothing if the turn doesn't have a persisted
          queryId/answerId yet, so this is safe to mount unconditionally
          on done turns. */}
      {status === 'done' && <HelpFeedback turn={turn} />}
    </div>
  )
}

// ── Citations ────────────────────────────────────────────────────────────

const LANE_META = {
  corpus:         { icon: '📘', label: 'Guide',     hrefFor: c => `/help/${c.slug}` },
  privateNotes:   { icon: '🔒', label: 'Your note', hrefFor: ()  => '/profile?section=journal' },
  communityNotes: { icon: '🌐', label: 'Community', hrefFor: ()  => '/profile?section=journal' },
}

function CitationsList({ citations }) {
  return (
    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
      <div className="mb-1 opacity-80">Sources</div>
      <ul className="flex flex-wrap gap-1.5">
        {citations.map(c => {
          const meta = LANE_META[c.lane] ?? LANE_META.corpus
          const href = meta.hrefFor(c)
          const title = c.title || c.slug || 'source'
          const byline = c.lane === 'communityNotes' && c.author?.displayName
            ? ` · ${c.author.displayName}` : ''
          // Internal links use react-router; external would need an anchor.
          // All our lanes link in-app for now.
          return (
            <li key={c.docId}>
              <Link
                to={href}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                }}
                title={`${meta.label}: ${title}${byline}`}
                data-lane={c.lane}
              >
                <span aria-hidden="true">{meta.icon}</span>
                <span className="truncate max-w-[14rem]">{title}</span>
                {byline ? <span className="opacity-70">{byline}</span> : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export { CitationsList }

// Exposed for tests so they can assert the copy maps without re-rendering.
export { ERROR_COPY, errorMessage }
