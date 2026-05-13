// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /admin/help — Help System docs list.
 *
 * Lists every HelpDoc with category, status, version, and last-edit
 * metadata. Filter by status. Click a row to open the editor.
 */

import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

const STATUS_FILTERS = ['', 'PUBLISHED', 'DRAFT', 'ARCHIVED']

export default function AdminHelpDocsPage() {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('')

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const opts = status ? { status, limit: 200 } : { limit: 200 }
      const { docs } = await api.admin.help.listDocs(token, opts)
      setDocs(docs ?? [])
    } catch (e) {
      setError('Failed to load help docs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [status])

  const grouped = docs.reduce((acc, d) => {
    (acc[d.category] ||= []).push(d)
    return acc
  }, {})
  const categoryNames = Object.keys(grouped).sort()

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-end justify-between pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Help docs</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {docs.length} doc{docs.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          to="/admin/help/new"
          data-testid="new-doc-button"
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-white"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          + New doc
        </Link>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <label style={{ color: 'var(--text-secondary)' }}>Status:</label>
        {STATUS_FILTERS.map(s => (
          <button
            key={s || 'all'}
            data-testid={`filter-${s || 'all'}`}
            onClick={() => setStatus(s)}
            className="px-2 py-1 rounded-md border"
            style={{
              borderColor: status === s ? 'var(--color-blue-600)' : 'var(--border-default)',
              color: status === s ? 'var(--color-blue-700)' : 'var(--text-secondary)',
              backgroundColor: status === s ? 'var(--color-blue-50)' : 'transparent',
              fontWeight: status === s ? 600 : 400,
            }}
          >
            {s || 'all'}
          </button>
        ))}
      </div>

      {loading && <Spinner />}
      {error && <p className="text-sm" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

      {!loading && docs.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>No docs match this filter.</p>
      )}

      {!loading && categoryNames.map(cat => (
        <section key={cat} className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            {cat}
          </h2>
          <div
            className="rounded-xl border divide-y"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor:     'var(--border-default)',
              boxShadow:       'var(--shadow-card)',
            }}
          >
            {grouped[cat].map(d => (
              <Link
                key={d.id}
                to={`/admin/help/${d.id}`}
                data-testid={`doc-row-${d.slug}`}
                className="flex items-center justify-between px-4 py-2 no-underline hover:bg-[var(--bg-surface-hover)]"
                style={{ color: 'inherit', borderColor: 'var(--border-default)' }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{d.title}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {d.slug} · v{d.version} · {fmtDate(d.updatedAt)}
                  </div>
                </div>
                <StatusBadge status={d.status} />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function StatusBadge({ status }) {
  const colors = {
    PUBLISHED: { bg: 'var(--color-teal-50)',  fg: 'var(--color-teal-700)'  },
    DRAFT:     { bg: 'var(--color-amber-50)', fg: 'var(--color-amber-700)' },
    ARCHIVED:  { bg: 'var(--bg-surface)',     fg: 'var(--text-muted)'      },
  }[status] || { bg: 'var(--bg-surface)', fg: 'var(--text-muted)' }
  return (
    <span
      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ backgroundColor: colors.bg, color: colors.fg }}
    >
      {status}
    </span>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function fmtDate(ts) {
  if (!ts) return ''
  try { return new Date(ts).toLocaleString() } catch { return '' }
}
