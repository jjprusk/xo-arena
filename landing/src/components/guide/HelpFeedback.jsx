// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * HelpFeedback — Sprint 3 §3.3 of doc/Help_System_Sprint_Tracker.md.
 *
 * Two thumb buttons (Helpful / Not Helpful) shown below a completed
 * answer. On thumb-down, category chips appear (OFF_TOPIC, OUTDATED,
 * WRONG, INCOMPLETE). An optional collapsed comment textarea is
 * available either way; on submit it persists via the §3.6 endpoint.
 *
 * Behaviour:
 *   - On mount, load existing feedback for (queryId, answerId) via the
 *     helpStore.loadFeedback action; reflect prior state so re-rendering
 *     a thread doesn't lose the user's previous signal.
 *   - Tapping the same thumb is a no-op (don't re-POST).
 *   - Tapping HELPFUL after NOT_HELPFUL clears the category + comment
 *     server-side per the §3.3 flip rule; the UI mirrors that.
 *   - All POSTs go through helpStore.submitFeedback so the same code
 *     path is exercised by §3.5 implicit signals too.
 *   - "Thanks — that helps us improve." flashes after every save.
 *
 * The component renders nothing if the turn has no queryId/answerId
 * (e.g., status is still streaming or errored before persisting an
 * answer row). It only attaches to terminal `done` turns.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { useHelpStore } from '../../store/helpStore.js'
import { getToken } from '../../lib/getToken.js'

const CATEGORY_LABELS = {
  OFF_TOPIC:  'Off topic',
  OUTDATED:   'Outdated',
  WRONG:      'Wrong',
  INCOMPLETE: 'Incomplete',
}

const THANKS_HIDE_MS = 2500

export default function HelpFeedback({ turn }) {
  const submitFeedback = useHelpStore(s => s.submitFeedback)
  const loadFeedback   = useHelpStore(s => s.loadFeedback)

  const [signal,   setSignal]   = useState(null) // 'HELPFUL' | 'NOT_HELPFUL' | null
  const [category, setCategory] = useState(null)
  const [comment,  setComment]  = useState('')
  const [commentOpen, setCommentOpen] = useState(false)
  const [showThanks,  setShowThanks]  = useState(false)
  const [busy,        setBusy]        = useState(false)

  const queryId  = turn?.queryId  ?? null
  const answerId = turn?.answerId ?? null

  // On mount (or when the turn changes), fetch any prior feedback for
  // this (queryId, answerId) so we reflect the user's previous state.
  useEffect(() => {
    if (!queryId || !answerId) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        const fb = await loadFeedback({ queryId, answerId, token })
        if (cancelled || !fb) return
        setSignal(fb.signal   ?? null)
        setCategory(fb.category ?? null)
        setComment(fb.comment   ?? '')
        if (fb.comment) setCommentOpen(true)
      } catch {
        // Endpoint not built yet (Sprint 3 §3.6 lands at the same time)
        // or auth glitch — silent fail; user can still submit fresh.
      }
    })()
    return () => { cancelled = true }
  }, [queryId, answerId, loadFeedback])

  const flashThanks = useCallback(() => {
    setShowThanks(true)
    const t = setTimeout(() => setShowThanks(false), THANKS_HIDE_MS)
    return () => clearTimeout(t)
  }, [])

  const post = useCallback(async (patch) => {
    if (!queryId || !answerId) return
    setBusy(true)
    try {
      const token = await getToken()
      await submitFeedback({ queryId, answerId, token, ...patch })
      flashThanks()
    } catch {
      // Surface a tiny inline error? For v1 we just swallow — feedback is
      // non-critical UX; the user can re-click to retry.
    } finally {
      setBusy(false)
    }
  }, [queryId, answerId, submitFeedback, flashThanks])

  const onThumb = useCallback((next) => {
    if (busy) return
    if (signal === next) return  // re-tap same thumb = no-op
    const wasNotHelpful = signal === 'NOT_HELPFUL'
    setSignal(next)
    // Optimistic mirror of the §3.3 server-side flip rule.
    if (next === 'HELPFUL' && wasNotHelpful) {
      setCategory(null)
      setComment('')
      setCommentOpen(false)
    }
    post({ signal: next })
  }, [signal, busy, post])

  const onCategory = useCallback((cat) => {
    if (busy || signal !== 'NOT_HELPFUL') return
    if (category === cat) return
    setCategory(cat)
    post({ category: cat })
  }, [signal, category, busy, post])

  const onCommentSave = useCallback(() => {
    const trimmed = comment.trim()
    if (trimmed.length === 0 && !category && signal == null) return
    post({ comment: trimmed.length > 0 ? trimmed : null })
  }, [comment, category, signal, post])

  // Don't render if the turn isn't a persisted answer yet.
  if (!queryId || !answerId) return null

  const isUp   = signal === 'HELPFUL'
  const isDown = signal === 'NOT_HELPFUL'

  return (
    <div
      className="flex flex-col gap-2 mt-2 pt-2"
      style={{ borderTop: '1px dashed var(--border-default)' }}
      data-testid="help-feedback"
    >
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <span>Was this helpful?</span>

        <button
          type="button"
          onClick={() => onThumb('HELPFUL')}
          disabled={busy}
          aria-label="Mark answer helpful"
          aria-pressed={isUp}
          data-testid="thumb-up"
          className="rounded-full px-2 py-0.5 transition-colors"
          style={{
            background: isUp ? 'var(--color-green-100, #d1fae5)' : 'transparent',
            color:      isUp ? 'var(--color-green-700, #047857)' : 'var(--text-muted)',
            border:     '1px solid ' + (isUp ? 'var(--color-green-600, #059669)' : 'var(--border-default)'),
            opacity:    busy ? 0.6 : 1,
            cursor:     busy ? 'wait' : 'pointer',
          }}
        >
          👍
        </button>

        <button
          type="button"
          onClick={() => onThumb('NOT_HELPFUL')}
          disabled={busy}
          aria-label="Mark answer not helpful"
          aria-pressed={isDown}
          data-testid="thumb-down"
          className="rounded-full px-2 py-0.5 transition-colors"
          style={{
            background: isDown ? 'var(--color-red-100, #fee2e2)' : 'transparent',
            color:      isDown ? 'var(--color-red-700, #b91c1c)' : 'var(--text-muted)',
            border:     '1px solid ' + (isDown ? 'var(--color-red-600, #dc2626)' : 'var(--border-default)'),
            opacity:    busy ? 0.6 : 1,
            cursor:     busy ? 'wait' : 'pointer',
          }}
        >
          👎
        </button>

        {showThanks && (
          <span
            data-testid="thanks-flash"
            className="ml-2"
            style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}
          >
            Thanks — that helps us improve.
          </span>
        )}
      </div>

      {isDown && (
        <div className="flex flex-wrap gap-1" data-testid="category-chips">
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
            const active = category === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => onCategory(key)}
                disabled={busy}
                aria-pressed={active}
                data-testid={`chip-${key}`}
                className="text-[11px] rounded-full px-2 py-0.5 transition-colors"
                style={{
                  background: active ? 'var(--color-blue-100, #dbeafe)' : 'transparent',
                  color:      active ? 'var(--color-blue-700, #1d4ed8)' : 'var(--text-muted)',
                  border:     '1px solid ' + (active ? 'var(--color-blue-600, #2563eb)' : 'var(--border-default)'),
                  cursor:     busy ? 'wait' : 'pointer',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {(signal || commentOpen) && (
        <div className="flex flex-col gap-1">
          {!commentOpen ? (
            <button
              type="button"
              onClick={() => setCommentOpen(true)}
              className="text-[11px] self-start hover:underline"
              style={{ color: 'var(--text-muted)' }}
            >
              Add a comment →
            </button>
          ) : (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onBlur={onCommentSave}
                placeholder="Anything else you want to share?"
                rows={2}
                maxLength={2000}
                aria-label="Optional feedback comment"
                data-testid="comment-input"
                className="resize-none rounded-md text-sm p-2 outline-none"
                style={{
                  background: 'var(--bg-surface)',
                  border:     '1px solid var(--border-default)',
                  color:      'var(--text-primary)',
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
