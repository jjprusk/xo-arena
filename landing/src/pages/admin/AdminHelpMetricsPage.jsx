// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /admin/help/metrics — Sprint 4 §4.3 dashboard.
 *
 * Six rollups from a single `GET /api/v1/admin/help/metrics` call:
 *   • Questions per day (sparkline of bars)
 *   • Feedback totals + helpful%
 *   • NOT_HELPFUL by category
 *   • Filter-trigger rate
 *   • Top 10 retrieved chunks
 *   • Top 20 no-source queries (gap-filling candidates)
 *
 * Charts are simple CSS-bar visualizations — no extra chart library on
 * the admin bundle. The bars scale to the max value in the series so
 * they read at a glance.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

const WINDOW_OPTIONS = [
  { value: 7,   label: '7d'  },
  { value: 30,  label: '30d' },
  { value: 90,  label: '90d' },
]

function pct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

function shortDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function AdminHelpMetricsPage() {
  const [days, setDays]       = useState(30)
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const token = await getToken()
        const out = await api.admin.help.getMetrics(token, days)
        if (!cancelled) setData(out)
      } catch {
        if (!cancelled) setError('Failed to load metrics.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [days])

  const maxDayCount = useMemo(() => {
    if (!data?.questionsPerDay?.length) return 0
    return Math.max(...data.questionsPerDay.map(d => d.count))
  }, [data])

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6" data-testid="help-metrics-page">
      <div className="flex items-end justify-between pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Help metrics</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Rolling {data?.windowDays ?? days}-day window
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {WINDOW_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              data-testid={`window-${value}`}
              type="button"
              onClick={() => setDays(value)}
              className="px-2 py-1 rounded-md border"
              style={{
                borderColor:     days === value ? 'var(--color-blue-600)' : 'var(--border-default)',
                color:           days === value ? 'var(--color-blue-700)' : 'var(--text-secondary)',
                backgroundColor: days === value ? 'var(--color-blue-50)'  : 'transparent',
                fontWeight:      days === value ? 600                       : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>Loading metrics…</div>}
      {error && (
        <div data-testid="metrics-error" className="py-3 px-4 text-sm rounded-md" style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-700)' }}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Headline tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile testid="tile-questions" label="Questions" value={data.questionsPerDay.reduce((a, d) => a + d.count, 0).toString()} />
            <Tile testid="tile-helpful"   label="Helpful%"  value={pct(data.helpfulPct, 0)} />
            <Tile testid="tile-feedback"  label="Feedback"  value={`${data.feedbackTotals.total}`} sub={`👍 ${data.feedbackTotals.helpful} · 👎 ${data.feedbackTotals.notHelpful}`} />
            <Tile testid="tile-filter"    label="Filter rate" value={pct(data.filterTriggerRate.rate, 1)} sub={`${data.filterTriggerRate.triggered}/${data.filterTriggerRate.total}`} />
          </div>

          {/* Questions per day */}
          <section data-testid="section-per-day">
            <h2 className="text-sm font-semibold mb-2">Questions per day</h2>
            <div className="flex items-end gap-0.5 h-32 p-2 rounded border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
              {data.questionsPerDay.map(d => {
                const heightPct = maxDayCount > 0 ? Math.max(2, (d.count / maxDayCount) * 100) : 2
                return (
                  <div
                    key={d.day}
                    title={`${d.day}: ${d.count}`}
                    className="flex-1 rounded-t"
                    style={{
                      height:          `${heightPct}%`,
                      backgroundColor: d.count > 0 ? 'var(--color-blue-500)' : 'var(--border-default)',
                      minWidth:        '2px',
                    }}
                  />
                )
              })}
            </div>
            <div className="flex justify-between text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
              <span>{shortDate(data.questionsPerDay[0]?.day)}</span>
              <span>{shortDate(data.questionsPerDay.at(-1)?.day)}</span>
            </div>
          </section>

          {/* NOT_HELPFUL by category */}
          {data.notHelpfulByCategory.length > 0 && (
            <section data-testid="section-by-category">
              <h2 className="text-sm font-semibold mb-2">"Not helpful" by category</h2>
              <CategoryBars items={data.notHelpfulByCategory} />
            </section>
          )}

          {/* Top retrieved chunks */}
          {data.topRetrievedChunks.length > 0 && (
            <section data-testid="section-top-chunks">
              <h2 className="text-sm font-semibold mb-2">Top retrieved chunks</h2>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'var(--text-secondary)' }}>
                    <th className="text-left font-medium pb-1.5">Doc</th>
                    <th className="text-left font-medium pb-1.5">Category</th>
                    <th className="text-right font-medium pb-1.5">Position</th>
                    <th className="text-right font-medium pb-1.5">Hits</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRetrievedChunks.map(c => (
                    <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border-default)' }}>
                      <td className="py-1.5">
                        <Link to={`/help/${c.slug}`} className="underline" style={{ color: 'var(--color-blue-700)' }}>
                          {c.title}
                        </Link>
                      </td>
                      <td>{c.category}</td>
                      <td className="text-right" style={{ color: 'var(--text-secondary)' }}>#{c.position}</td>
                      <td className="text-right font-medium">{c.hits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Top no-source queries */}
          {data.topNoSourceQueries.length > 0 && (
            <section data-testid="section-no-source">
              <h2 className="text-sm font-semibold mb-2">Recent no-source queries (gap-filling candidates)</h2>
              <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                These got no retrieved chunks — write a doc to cover them.
              </p>
              <ul className="space-y-1">
                {data.topNoSourceQueries.map(q => (
                  <li key={q.queryId} className="flex items-center justify-between gap-2 p-2 rounded text-xs" style={{ backgroundColor: 'var(--bg-surface)' }}>
                    <span className="flex-1 truncate">{q.text}</span>
                    <Link
                      to={`/admin/help/new?seedQuestion=${encodeURIComponent(q.text)}`}
                      data-testid={`nosource-create-${q.queryId}`}
                      className="text-[10px] px-2 py-0.5 rounded text-white"
                      style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
                    >
                      + Doc
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function Tile({ label, value, sub, testid }) {
  return (
    <div data-testid={testid} className="p-3 rounded border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <div className="text-2xl font-semibold mt-0.5">{value}</div>
      {sub && <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  )
}

function CategoryBars({ items }) {
  const max = Math.max(...items.map(i => i.count), 1)
  return (
    <ul className="space-y-1 text-xs">
      {items.map(i => (
        <li key={i.category} className="flex items-center gap-2">
          <span className="w-24 truncate" style={{ color: 'var(--text-secondary)' }}>{i.category}</span>
          <div className="flex-1 h-4 rounded" style={{ backgroundColor: 'var(--bg-surface)' }}>
            <div
              className="h-full rounded"
              style={{
                width:           `${(i.count / max) * 100}%`,
                backgroundColor: 'var(--color-amber-500)',
              }}
            />
          </div>
          <span className="w-8 text-right font-medium">{i.count}</span>
        </li>
      ))}
    </ul>
  )
}
