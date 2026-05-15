// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * HelpInput — Sprint 3 §3.1 of doc/Help_System_Sprint_Tracker.md.
 *
 * Growable textarea wired to `helpStore.sendQuestion`. Replaces the
 * placeholder div in GuidePanel.jsx (Phase 4 chat input).
 *
 * Behaviour:
 *   - Enter submits, Shift+Enter inserts a newline.
 *   - Auto-resizes 1 → 4 rows; scrolls past 4.
 *   - Disabled while a request is in flight (one-question-per-panel guard
 *     also lives in the store; this is the UI gate).
 *   - Disclosure microcopy under the input + a "Browse all help →" link
 *     to /help (Sprint 3 §3.7 lands the page; the link is wired now so
 *     pre-§3.7 visits land cleanly on a 404 placeholder rather than a
 *     dead button).
 *
 * The route+slot+game context that the prompt sees is sourced from props
 * (the GuidePanel knows where the user is; HelpInput just forwards).
 */

import React, { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useHelpStore } from '../../store/helpStore.js'
import { getToken } from '../../lib/getToken.js'

const MAX_ROWS = 4
const MAX_LEN  = 1000  // matches backend zod cap

export default function HelpInput({ context }) {
  const inFlight   = useHelpStore(s => s.inFlightTurnId !== null)
  const sendQuestion = useHelpStore(s => s.sendQuestion)
  const [value, setValue] = useState('')
  const taRef = useRef(null)

  // Row count derived from line breaks so the textarea grows naturally as
  // the user types; clamped so the panel doesn't get pushed around.
  const rows = Math.min(
    MAX_ROWS,
    Math.max(1, (value.match(/\n/g)?.length ?? 0) + 1),
  )

  const submit = useCallback(async () => {
    const trimmed = value.trim()
    if (!trimmed || inFlight) return
    setValue('')
    const token = await getToken()
    await sendQuestion({ question: trimmed, context, token })
  }, [value, inFlight, sendQuestion, context])

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }, [submit])

  const onChange = useCallback((e) => {
    const next = e.target.value
    if (next.length > MAX_LEN) {
      setValue(next.slice(0, MAX_LEN))
    } else {
      setValue(next)
    }
  }, [])

  return (
    <div
      className="shrink-0 px-4 py-3"
      style={{ borderTop: '1px solid var(--border-default)' }}
    >
      <div
        className="flex items-end gap-2 rounded-2xl px-3 py-2"
        style={{
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-default)',
          opacity: inFlight ? 0.7 : 1,
        }}
      >
        <span style={{ fontSize: 16, lineHeight: '1.4rem', flexShrink: 0 }}>🤖</span>
        <textarea
          ref={taRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={inFlight}
          rows={rows}
          maxLength={MAX_LEN}
          placeholder={inFlight ? 'Thinking…' : 'Ask Guide anything…'}
          aria-label="Ask the Guide a question"
          className="flex-1 resize-none bg-transparent text-sm outline-none"
          style={{
            color: 'var(--text-primary)',
            lineHeight: '1.4rem',
            // Letting the rows attribute drive height keeps the layout
            // predictable; explicit min/max height prevents jitter on
            // single-row content.
            minHeight: '1.4rem',
            maxHeight: `${1.4 * MAX_ROWS}rem`,
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={inFlight || value.trim().length === 0}
          aria-label="Send question to Guide"
          className="rounded-full text-sm font-medium px-3 py-1 transition-opacity"
          style={{
            background: 'var(--color-blue-600, #2563eb)',
            color: 'white',
            opacity: (inFlight || value.trim().length === 0) ? 0.4 : 1,
            cursor:  (inFlight || value.trim().length === 0) ? 'default' : 'pointer',
            border: 'none',
            flexShrink: 0,
          }}
        >
          {inFlight ? '…' : 'Ask'}
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          Questions are processed by our AI service. Don't include personal details.
        </span>
        <Link
          to="/help"
          className="text-[11px] hover:underline shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          Browse all help →
        </Link>
      </div>
    </div>
  )
}
