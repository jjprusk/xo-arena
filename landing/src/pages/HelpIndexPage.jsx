// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * HelpIndexPage — Sprint 3 §3.7 of doc/Help_System_Sprint_Tracker.md.
 *
 * Public browse surface at `/help`. No auth required. Renders the corpus
 * grouped by category — title links navigate to the single-doc page.
 *
 * Data source: `GET /api/v1/help/docs` returns PUBLISHED docs with
 * { slug, title, category, tags, updatedAt } and no body. Bodies are
 * loaded on-demand by HelpDocPage to keep the index light.
 */

import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const BASE = import.meta.env?.VITE_API_URL ?? ''

// Friendly labels for category buckets. Falls back to the raw category
// string if a new category appears that we haven't labelled yet.
const CATEGORY_LABEL = {
  basics:     'Getting started',
  games:      'Games',
  bots:       'Bots',
  training:   'Training & ML',
  tournaments:'Tournaments',
  gameplay:   'Gameplay',
  economy:    'Credits & ranking',
  account:    'Account',
  admin:      'Admin',
}
const CATEGORY_ORDER = [
  'basics', 'games', 'bots', 'training', 'tournaments',
  'gameplay', 'economy', 'account', 'admin',
]

function groupByCategory(docs) {
  const out = {}
  for (const d of docs) {
    if (!out[d.category]) out[d.category] = []
    out[d.category].push(d)
  }
  return out
}

function orderedCategories(grouped) {
  // Known categories first in our preferred order; any unrecognised
  // category appended at the end alphabetically so the list doesn't
  // hide content if the corpus grows.
  const known = CATEGORY_ORDER.filter(c => grouped[c]?.length > 0)
  const extras = Object.keys(grouped)
    .filter(c => !CATEGORY_ORDER.includes(c))
    .sort()
  return [...known, ...extras]
}

export default function HelpIndexPage() {
  const [docs,    setDocs]    = useState(null)   // null = loading, [] = empty, [...]=loaded
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/help/docs`)
        if (!res.ok) throw new Error('http_' + res.status)
        const body = await res.json()
        if (!cancelled) setDocs(Array.isArray(body?.docs) ? body.docs : [])
      } catch (err) {
        if (!cancelled) setError(String(err?.message ?? err))
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6" data-testid="help-index-page">
        <h1 className="text-2xl font-semibold mb-2">Help</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Couldn't load the help index. Try refreshing.
        </p>
      </div>
    )
  }
  if (docs === null) {
    return (
      <div className="max-w-3xl mx-auto p-6" data-testid="help-index-page">
        <h1 className="text-2xl font-semibold mb-2">Help</h1>
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    )
  }

  const grouped = groupByCategory(docs)
  const cats    = orderedCategories(grouped)

  return (
    <div className="max-w-3xl mx-auto p-6" data-testid="help-index-page">
      <h1 className="text-2xl font-semibold mb-2">Help</h1>
      <p className="mb-6" style={{ color: 'var(--text-muted)' }}>
        Everything we've written about AI Arena, grouped by topic. You can also ask the Guide directly from the drawer on any page.
      </p>

      {docs.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>No published docs yet.</p>
      )}

      {cats.map(cat => (
        <section key={cat} className="mb-6" data-testid={`help-cat-${cat}`}>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            {CATEGORY_LABEL[cat] ?? cat}
          </h2>
          <ul className="flex flex-col gap-1">
            {grouped[cat].map(d => (
              <li key={d.slug}>
                <Link
                  to={`/help/${encodeURIComponent(d.slug)}`}
                  className="hover:underline"
                  style={{ color: 'var(--color-blue-600, #2563eb)' }}
                >
                  {d.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// Exposed so tests can verify the grouping helper in isolation.
export { groupByCategory, orderedCategories, CATEGORY_LABEL, CATEGORY_ORDER }
