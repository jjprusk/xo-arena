// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useGuideStore } from '../store/guideStore.js'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

// Matches GitHub's heading anchor algorithm:
// lowercase → strip non-alphanumeric/space/hyphen → each space → hyphen
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')  // remove punctuation (leaves spaces intact, including doubles)
    .replace(/\s/g, '-')       // each space → hyphen (preserves double-hyphens from e.g. "A & B")
    .replace(/^-+|-+$/g, '')   // trim edges
}

function makeHeading(level) {
  const Tag = `h${level}`
  return function Heading({ children, ...props }) {
    const text = React.Children.toArray(children)
      .map(c => (typeof c === 'string' ? c : c?.props?.children ?? ''))
      .join('')
    const id = slugify(text)
    return <Tag id={id} {...props}>{children}</Tag>
  }
}

const mdComponents = {
  h1: makeHeading(1),
  h2: makeHeading(2),
  h3: makeHeading(3),
  h4: makeHeading(4),
  a: ({ href, children, ...props }) => {
    if (href?.startsWith('#')) {
      return (
        <a
          href={href}
          onClick={e => {
            e.preventDefault()
            document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' })
          }}
          style={{ color: 'var(--color-blue-600)', textDecoration: 'underline', cursor: 'pointer' }}
          {...props}
        >
          {children}
        </a>
      )
    }
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-blue-600)', textDecoration: 'underline' }} {...props}>{children}</a>
  },
}

function highlightMarkdown(text, query) {
  if (!query) return text
  // Escape special regex chars in the query
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'gi')
  // Wrap matches in a marker that survives markdown parsing.
  // We use an inline HTML <mark> tag — react-markdown renders it as-is.
  return text.replace(re, m => `<mark class="search-highlight">${m}</mark>`)
}

export default function GymGuidePage() {
  const { state } = useLocation()
  const fromGym = state?.from === '/gym'
  const [content, setContent]   = useState(null)
  const [query, setQuery]       = useState('')
  const [matchCount, setMatchCount] = useState(0)

  useEffect(() => {
    fetch('/bot-training-guide.md')
      .then(r => r.text())
      .then(setContent)
  }, [])

  // Close guide panel immediately so the page feels unobstructed
  useEffect(() => { useGuideStore.getState().close() }, [])

  // Journey step 4: visiting the AI Training Guide page — update store directly so UI reflects completion without waiting for socket
  useEffect(() => {
    getToken().then(token => {
      if (!token) return
      api.guide.triggerStep(4, token).then(() => {
        const store = useGuideStore.getState()
        const current = store.journeyProgress?.completedSteps ?? []
        if (!current.includes(4)) {
          store.applyJourneyStep({ completedSteps: [...current, 4] })
        }
      }).catch(() => {})
    }).catch(() => {})
  }, [])

  const displayContent = useMemo(() => {
    if (!content) return content
    if (!query.trim()) { setMatchCount(0); return content }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escaped, 'gi')
    const matches = content.match(re)
    setMatchCount(matches ? matches.length : 0)
    return highlightMarkdown(content, query.trim())
  }, [content, query])

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        {fromGym && (
          <Link
            to="/gym"
            className="text-sm font-medium"
            style={{ color: 'var(--color-blue-600)' }}
          >
            ← Back to Gym
          </Link>
        )}
        <a
          href="/bot-training-guide.pdf"
          download="Bot_Training_Guide.pdf"
          className="text-sm font-medium px-4 py-2 rounded-lg border transition-colors"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: 'var(--bg-surface)',
            color: 'var(--text-primary)',
          }}
        >
          Download PDF
        </a>
      </div>

      {/* Search bar */}
      {content != null && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search guide…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full text-sm px-4 py-2 rounded-lg border outline-none"
              style={{
                borderColor: query ? 'var(--color-blue-500)' : 'var(--border-default)',
                backgroundColor: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            )}
          </div>
          {query.trim() && (
            <span className="text-xs whitespace-nowrap" style={{ color: matchCount > 0 ? 'var(--text-secondary)' : 'var(--color-red-500)' }}>
              {matchCount > 0 ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}` : 'No matches'}
            </span>
          )}
        </div>
      )}

      {/* Rendered markdown */}
      {content == null
        ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        : (
          <div className="rounded-xl border p-8 overflow-x-auto" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
            <div className="prose-guide min-w-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={mdComponents}>{displayContent}</ReactMarkdown>
            </div>
          </div>
        )
      }
    </div>
  )
}
