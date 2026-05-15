// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * HelpDocPage — Sprint 3 §3.7 of doc/Help_System_Sprint_Tracker.md.
 *
 * Single-doc renderer at `/help/:slug`. No auth required. Fetches
 * `GET /api/v1/help/docs/:slug`, renders the Markdown body, links back
 * to the index. Returns a friendly 404 view if the slug isn't found
 * (the most common cause is a stale link from outside the platform).
 *
 * The Markdown uses the same `.help-answer-md` styling as the Guide
 * drawer so internal links look consistent.
 */

import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const BASE = import.meta.env?.VITE_API_URL ?? ''

export default function HelpDocPage() {
  const { slug } = useParams()
  const [doc,   setDoc]   = useState(null)   // null = loading, false = 404
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setDoc(null)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/help/docs/${encodeURIComponent(slug)}`)
        if (res.status === 404) {
          if (!cancelled) setDoc(false)
          return
        }
        if (!res.ok) throw new Error('http_' + res.status)
        const body = await res.json()
        if (!cancelled) setDoc(body?.doc ?? false)
      } catch (err) {
        if (!cancelled) setError(String(err?.message ?? err))
      }
    })()
    return () => { cancelled = true }
  }, [slug])

  // Loading
  if (doc === null && !error) {
    return (
      <div className="max-w-3xl mx-auto p-6" data-testid="help-doc-page">
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    )
  }
  // Error (non-404)
  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6" data-testid="help-doc-page">
        <Link to="/help" style={{ color: 'var(--text-muted)' }}>← Help index</Link>
        <h1 className="text-2xl font-semibold mt-2">Couldn't load this doc</h1>
        <p style={{ color: 'var(--text-muted)' }}>Try refreshing, or head back to the help index.</p>
      </div>
    )
  }
  // 404
  if (doc === false) {
    return (
      <div className="max-w-3xl mx-auto p-6" data-testid="help-doc-page">
        <Link to="/help" style={{ color: 'var(--text-muted)' }}>← Help index</Link>
        <h1 className="text-2xl font-semibold mt-2">Doc not found</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          We don't have a doc at <code>/help/{slug}</code>. It may have been renamed or archived. Browse the <Link to="/help">help index</Link> for the current list.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6" data-testid="help-doc-page">
      <Link to="/help" className="hover:underline" style={{ color: 'var(--text-muted)' }}>
        ← Help index
      </Link>
      <article className="help-answer-md mt-2">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {doc.body}
        </ReactMarkdown>
      </article>
    </div>
  )
}
