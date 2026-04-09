import React, { useState, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'

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
  const { state } = useLocation()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const fromAbout = state?.from === '/about'
  const fromGuide = searchParams.get('from') === 'guide'
  const [content, setContent] = useState(null)
  const [query, setQuery] = useState('')
  const [matchCount, setMatchCount] = useState(0)
  const [openSection, setOpenSection] = useState(null)

  useEffect(() => {
    fetch('/faq.md', { cache: 'no-store' })
      .then(r => r.text())
      .then(setContent)
  }, [])

  // Journey step 2: visiting the FAQ page (fire-and-forget)
  useEffect(() => {
    getToken().then(token => {
      if (token) api.guide.triggerStep(2, token).catch(() => {})
    }).catch(() => {})
  }, [])

  // Parse markdown into preamble (H1) + sections (H2 blocks)
  const { preamble, sections } = useMemo(() => {
    if (!content) return { preamble: '', sections: [] }
    const parts = content.split(/^(?=## )/m)
    const preamble = parts[0]
    const sections = parts.slice(1).map(part => {
      const nl = part.indexOf('\n')
      const title = nl === -1 ? part.replace(/^## /, '') : part.slice(3, nl)
      const body = nl === -1 ? '' : part.slice(nl + 1).trim()
      return { title, body }
    })
    return { preamble, sections }
  }, [content])

  const searching = !!query.trim()

  // Count matches and compute highlighted bodies
  const highlightedSections = useMemo(() => {
    if (!searching) { setMatchCount(0); return sections.map(s => s.body) }
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(escaped, 'gi')
    const matches = content?.match(re)
    setMatchCount(matches ? matches.length : 0)
    return sections.map(s => highlightMarkdown(s.body, query.trim()))
  }, [content, sections, query, searching])

  function toggleSection(i) {
    setOpenSection(prev => prev === i ? null : i)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        {fromGuide && (
          <button
            onClick={() => navigate('/play?open-guide=1')}
            className="text-sm font-medium"
            style={{ color: 'var(--color-blue-600)' }}
          >
            ← Back to Guide
          </button>
        )}
        {fromAbout && !fromGuide && (
          <Link
            to="/about"
            className="text-sm font-medium"
            style={{ color: 'var(--color-blue-600)' }}
          >
            ← Back to About
          </Link>
        )}
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
          {searching && (
            <span className="text-xs whitespace-nowrap" style={{ color: matchCount > 0 ? 'var(--text-secondary)' : 'var(--color-red-500)' }}>
              {matchCount > 0 ? `${matchCount} match${matchCount !== 1 ? 'es' : ''}` : 'No matches'}
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {content == null
        ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
        : (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
            {/* H1 preamble */}
            {preamble.trim() && (
              <div className="px-6 pt-6 pb-2 prose-guide">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={mdComponents}>{preamble}</ReactMarkdown>
              </div>
            )}

            {/* Accordion sections */}
            {sections.map(({ title }, i) => {
              const isOpen = searching || openSection === i
              const id = slugify(title)
              return (
                <div key={i} id={id} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                  <button
                    onClick={() => toggleSection(i)}
                    className="w-full flex items-center justify-between px-6 py-4 text-left transition-colors hover:bg-[var(--bg-surface-hover)]"
                  >
                    <span className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</span>
                    <span className="ml-4 flex-shrink-0 text-3xl transition-transform" style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▾</span>
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-6 prose-guide">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={mdComponents}>{highlightedSections[i]}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }
    </div>
  )
}
