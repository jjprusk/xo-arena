import React, { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-')
    .replace(/^-+|-+$/g, '')
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
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(escaped, 'gi')
  return text.replace(re, m => `<mark class="search-highlight">${m}</mark>`)
}

export default function FAQPage() {
  const [content, setContent] = useState(null)
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)

  useEffect(() => {
    fetch('/faq.md')
      .then(r => r.text())
      .then(setContent)
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
        <Link
          to="/about"
          className="text-sm font-medium"
          style={{ color: 'var(--color-blue-600)' }}
        >
          ← Back to About
        </Link>
      </div>

      {/* Search bar */}
      {content != null && (
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Search FAQ…"
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
          <div className="rounded-xl border p-8" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
            <div className="prose-guide">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={mdComponents}>{displayContent}</ReactMarkdown>
            </div>
          </div>
        )
      }
    </div>
  )
}
