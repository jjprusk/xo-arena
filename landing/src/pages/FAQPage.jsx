// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { useGuideStore } from '../store/guideStore.js'


// x-position of the orb centre in the 320-wide nav SVG
const ORB_X = 258

function GuideReturnTip({ onDismiss }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Continue your journey"
        style={{
          background: '#e8eaed',
          border: '1.5px solid var(--color-amber-400)',
          borderRadius: '1rem',
          padding: '2rem 2rem 1.75rem',
          maxWidth: '28rem',
          width: '100%',
          boxShadow: '0 8px 48px rgba(0,0,0,0.55)',
          textAlign: 'center',
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.5rem' }}>
          Take your time
        </h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.65, margin: '0 0 1.75rem' }}>
          When you're done reading the FAQ, press the <strong style={{ color: 'var(--color-amber-500)' }}>Guide Button</strong> in
          the header above as illustrated to continue your journey.
        </p>

        {/* Nav bar illustration + animated finger */}
        <div style={{ position: 'relative', display: 'inline-block', width: 320 }}>
          <svg width="320" height="60" viewBox="0 0 320 60" fill="none" xmlns="http://www.w3.org/2000/svg"
            style={{ borderRadius: 10, display: 'block', boxShadow: '0 3px 16px rgba(0,0,0,0.5)' }}>
            <defs>
              {/* Orb gradient — matches GuideOrb idle state */}
              <linearGradient id="orbGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#5B82B8" />
                <stop offset="100%" stopColor="#3A5E8E" />
              </linearGradient>
              {/* User avatar teal */}
              <linearGradient id="avatarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0d9488" />
                <stop offset="100%" stopColor="#0f766e" />
              </linearGradient>
            </defs>

            {/* Nav bar background — white, matching the real header */}
            <rect width="320" height="60" rx="10" fill="#ffffff" />
            <line x1="0" y1="59.5" x2="320" y2="59.5" stroke="rgba(0,0,0,0.1)" />

            {/* AI Arena brand — matches the real landing header */}
            <foreignObject x="10" y="18" width="24" height="24">
              <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: 20, lineHeight: 1 }}>⚔</div>
            </foreignObject>
            <text x="36" y="35" fontSize="11" fontWeight="700" fill="#64748b" fontFamily="system-ui, sans-serif">AI Arena</text>


            {/* ── Break marks — lightning bolt zigzags, full height, not-to-scale indicator ── */}
            <path d="M 151 0 L 158 26 L 150 26 L 157 60" stroke="rgba(0,0,0,0.22)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M 163 0 L 170 26 L 162 26 L 169 60" stroke="rgba(0,0,0,0.22)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />

            {/* ── Guide orb — exact replica of GuideOrb component (idle state) ── */}
            {/* Outer glow */}
            <circle cx={ORB_X} cy="30" r="24" fill="rgba(91,130,184,0.12)" />
            {/* Button fill — idle gradient */}
            <circle cx={ORB_X} cy="30" r="20" fill="url(#orbGrad)" />
            {/* Box shadow ring */}
            <circle cx={ORB_X} cy="30" r="21" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
            {/* Progress ring track */}
            <circle cx={ORB_X} cy="30" r="18" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2.5"
              transform={`rotate(-90 ${ORB_X} 30)`} />
            {/* Progress arc — 1/8 done (step 1 complete) */}
            <circle cx={ORB_X} cy="30" r="18" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5"
              strokeDasharray={`${2 * Math.PI * 18 * (1/8)} ${2 * Math.PI * 18}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${ORB_X} 30)`} />
            {/* Robot emoji */}
            <foreignObject x={ORB_X - 11} y="19" width="22" height="22">
              <div xmlns="http://www.w3.org/1999/xhtml" style={{ fontSize: 18, lineHeight: 1, textAlign: 'center' }}>🤖</div>
            </foreignObject>

            {/* User avatar */}
            <circle cx="298" cy="30" r="13" fill="url(#avatarGrad)" />
            <text x="298" y="35" textAnchor="middle" fontSize="11" fill="white" fontWeight="700" fontFamily="system-ui, sans-serif">J</text>
          </svg>

          {/* Animated pointing finger — positioned below the orb */}
          <div style={{
            position: 'absolute',
            top: '100%',
            left: `${(ORB_X / 320) * 100}%`,
            transform: 'translateX(-50%)',
            animation: 'finger-bounce 1.1s ease-in-out infinite',
            marginTop: 6,
          }}>
            <span style={{ fontSize: 48, lineHeight: 1, display: 'block' }}>☝️</span>
          </div>
        </div>

        <div style={{ marginTop: '3.5rem' }}>
          <button
            onClick={onDismiss}
            className="btn btn-primary"
            style={{ minWidth: '9rem', fontSize: '0.9375rem' }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [openSection, setOpenSection] = useState(() => {
    const store = useGuideStore.getState()
    if (store.uiHints?.faqAccordionOpened) return null
    return 0
  })

  // Never show the overlay — user should land directly on the FAQ content.
  const showTip = false
  function dismissTip() {}

  useEffect(() => {
    useGuideStore.getState().setUiHint('faqAccordionOpened')
    useGuideStore.getState().setUiHint('faqTipShown')  // mark as seen so it never reappears
  }, [])

  useEffect(() => {
    fetch('/faq.md', { cache: 'no-store' })
      .then(r => r.text())
      .then(setContent)
  }, [])

  // Close guide panel so the page is unobstructed
  useEffect(() => { useGuideStore.getState().close() }, [])

  // Intelligent Guide v1 — the legacy "visit /faq → step 2" client-trigger
  // was removed. New step 2 is "Watch two bots battle" (Sprint 3). FAQ visits
  // no longer contribute to journey progress.

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
            onClick={() => navigate('/?open-guide=1')}
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

      {/* First-visit guide tip */}
      {showTip && <GuideReturnTip onDismiss={dismissTip} />}

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
