// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * /admin/help/queries — Sprint 4 §4.1 curation queue.
 *
 * Lists recent HelpQuery rows; filter-triggered ones float to the top.
 * Click a row to expand its detail: rendered answer, retrieved chunks,
 * full feedback rows, the original prompt context, and the matched
 * content-filter terms. From the detail you can mark the answer
 * reviewed (§4.2) or open the doc editor pre-filled with the question
 * as a seed comment.
 *
 * Default landing matches the §4.2 spec: unreviewed + filter-triggered
 * + last-24h. Clearing the filters falls back to the broader feed.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

const SIGNAL_FILTERS = [
  { value: '',            label: 'all'           },
  { value: 'NOT_HELPFUL', label: 'Not helpful'   },
  { value: 'HELPFUL',     label: 'Helpful'       },
  { value: 'NONE',        label: 'No feedback'   },
]
const CATEGORY_FILTERS = [
  { value: '',           label: 'any'        },
  { value: 'OFF_TOPIC',  label: 'Off-topic'  },
  { value: 'OUTDATED',   label: 'Outdated'   },
  { value: 'WRONG',      label: 'Wrong'      },
  { value: 'INCOMPLETE', label: 'Incomplete' },
]
const FILTER_FLAG_OPTIONS = [
  { value: '',      label: 'all'      },
  { value: 'true',  label: 'flagged'  },
  { value: 'false', label: 'clean'    },
]

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return d.toISOString()
}

function shortDate(iso) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AdminHelpQueriesPage() {
  // Default landing per §4.2 spec.
  const [signal, setSignal]       = useState('')
  const [category, setCategory]   = useState('')
  const [filterFlag, setFilterFlag] = useState('true')   // contentFilterTriggered=true
  const [unreviewed, setUnreviewed] = useState(true)
  const [last24h, setLast24h]     = useState(true)

  const [rows, setRows]       = useState([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [openId, setOpenId]   = useState(null)

  const queryOpts = useMemo(() => {
    const opts = { limit: 100 }
    if (signal)     opts.signal     = signal
    if (category && signal === 'NOT_HELPFUL') opts.category = category
    if (filterFlag) opts.contentFilterTriggered = filterFlag === 'true'
    if (unreviewed) opts.unreviewed = true
    if (last24h)    opts.since      = isoDaysAgo(1)
    return opts
  }, [signal, category, filterFlag, unreviewed, last24h])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const { rows, total } = await api.admin.help.listQueries(token, queryOpts)
      setRows(Array.isArray(rows) ? rows : [])
      setTotal(total ?? 0)
    } catch {
      setError('Failed to load curation queue.')
    } finally {
      setLoading(false)
    }
  }, [queryOpts])

  useEffect(() => { reload() }, [reload])

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4" data-testid="help-queries-page">
      <div className="flex items-end justify-between pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <div>
          <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>Curation queue</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {total} matching quer{total === 1 ? 'y' : 'ies'}
          </p>
        </div>
      </div>

      {/* Filter rows */}
      <div className="space-y-2 text-xs">
        <FilterRow label="Signal:"   value={signal}     setValue={setSignal}     options={SIGNAL_FILTERS}     testidPrefix="signal" />
        {signal === 'NOT_HELPFUL' && (
          <FilterRow label="Category:" value={category}   setValue={setCategory}   options={CATEGORY_FILTERS}   testidPrefix="category" />
        )}
        <FilterRow label="Filter:"   value={filterFlag} setValue={setFilterFlag} options={FILTER_FLAG_OPTIONS} testidPrefix="filter" />
        <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              data-testid="toggle-unreviewed"
              checked={unreviewed}
              onChange={e => setUnreviewed(e.target.checked)}
            />
            Unreviewed only
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              data-testid="toggle-last24h"
              checked={last24h}
              onChange={e => setLast24h(e.target.checked)}
            />
            Last 24h
          </label>
        </div>
      </div>

      {loading && <div className="py-6 text-sm" style={{ color: 'var(--text-secondary)' }}>Loading…</div>}
      {error && (
        <div data-testid="queries-error" className="py-3 px-4 text-sm rounded-md" style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-700)' }}>
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div data-testid="queries-empty" className="py-12 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
          No queries match these filters.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <ul className="space-y-1.5" data-testid="queries-list">
          {rows.map(row => (
            <li key={row.id}>
              <button
                type="button"
                data-testid={`row-${row.id}`}
                onClick={() => setOpenId(openId === row.id ? null : row.id)}
                className="w-full text-left px-3 py-2 rounded-md border transition-colors"
                style={{
                  borderColor:     openId === row.id ? 'var(--color-amber-500)' : 'var(--border-default)',
                  backgroundColor: openId === row.id ? 'var(--bg-surface)' : 'transparent',
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate flex-1 text-sm">{row.text}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px]">
                    {row.contentFilterTriggered && <Badge tone="red">filter</Badge>}
                    {row.signal === 'NOT_HELPFUL' && <Badge tone="orange">👎</Badge>}
                    {row.signal === 'HELPFUL' && <Badge tone="green">👍</Badge>}
                    {row.degraded && <Badge tone="gray">degraded</Badge>}
                    {row.reviewedAt && <Badge tone="blue">reviewed</Badge>}
                    <span style={{ color: 'var(--text-secondary)' }}>{shortDate(row.createdAt)}</span>
                  </div>
                </div>
              </button>
              {openId === row.id && <QueryDetail id={row.id} onReviewed={reload} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FilterRow({ label, value, setValue, options, testidPrefix }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {options.map(({ value: v, label: l }) => (
        <button
          key={v || 'all'}
          type="button"
          data-testid={`${testidPrefix}-${v || 'all'}`}
          onClick={() => setValue(v)}
          className="px-2 py-1 rounded-md border"
          style={{
            borderColor:     value === v ? 'var(--color-blue-600)'  : 'var(--border-default)',
            color:           value === v ? 'var(--color-blue-700)'  : 'var(--text-secondary)',
            backgroundColor: value === v ? 'var(--color-blue-50)'   : 'transparent',
            fontWeight:      value === v ? 600                       : 400,
          }}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

function Badge({ tone, children }) {
  const TONES = {
    red:    { bg: 'var(--color-red-50)',    fg: 'var(--color-red-700)'    },
    orange: { bg: 'var(--color-amber-50)',  fg: 'var(--color-amber-700)'  },
    green:  { bg: 'var(--color-green-50)',  fg: 'var(--color-green-700)'  },
    blue:   { bg: 'var(--color-blue-50)',   fg: 'var(--color-blue-700)'   },
    gray:   { bg: 'var(--bg-surface)',      fg: 'var(--text-secondary)'   },
  }
  const t = TONES[tone] ?? TONES.gray
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      {children}
    </span>
  )
}

function QueryDetail({ id, onReviewed }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [marking, setMarking] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const token = await getToken()
        const out = await api.admin.help.getQuery(id, token)
        if (!cancelled) setData(out)
      } catch {
        if (!cancelled) setError('Failed to load query.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [id])

  async function handleMarkReviewed(answerId) {
    if (!answerId || marking) return
    setMarking(true)
    try {
      const token = await getToken()
      await api.admin.help.markReviewed(answerId, token)
      onReviewed?.()  // refresh the parent list so the badge appears
    } catch {
      // Non-fatal — re-clicking will retry.
    } finally {
      setMarking(false)
    }
  }

  if (loading) return <div className="mt-2 ml-3 text-xs" style={{ color: 'var(--text-secondary)' }}>Loading detail…</div>
  if (error)   return <div data-testid={`detail-${id}-error`} className="mt-2 ml-3 text-xs" style={{ color: 'var(--color-red-700)' }}>{error}</div>
  if (!data?.query) return null

  const top = data.query.answers?.[0] ?? null
  return (
    <div data-testid={`detail-${id}`} className="mt-2 ml-3 p-3 rounded-md border space-y-3 text-xs" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}>
      {top && (
        <div>
          <div className="font-semibold mb-1">Rendered answer</div>
          <pre className="whitespace-pre-wrap text-xs p-2 rounded" style={{ backgroundColor: 'var(--bg-page)', color: 'var(--text-primary)' }}>
            {top.rendered}
          </pre>
          {top.contentFilterTriggered && top.contentFilterTerms?.length > 0 && (
            <div className="mt-1.5" style={{ color: 'var(--color-red-700)' }}>
              Filter terms: {top.contentFilterTerms.join(', ')}
            </div>
          )}
        </div>
      )}

      {data.chunks?.length > 0 && (
        <div>
          <div className="font-semibold mb-1">Retrieved chunks ({data.chunks.length})</div>
          <ul className="space-y-1">
            {data.chunks.map(c => (
              <li key={c.id} className="p-2 rounded" style={{ backgroundColor: 'var(--bg-page)' }}>
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <Link to={`/help/${c.doc?.slug}`} className="font-medium underline" style={{ color: 'var(--color-blue-700)' }}>
                    {c.doc?.title ?? c.doc?.slug ?? '(unknown)'}
                  </Link>
                  <span style={{ color: 'var(--text-secondary)' }}>#{c.position}</span>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{c.content.slice(0, 240)}{c.content.length > 240 ? '…' : ''}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {top?.feedback?.length > 0 && (
        <div>
          <div className="font-semibold mb-1">Feedback ({top.feedback.length})</div>
          <ul className="space-y-1">
            {top.feedback.map(f => (
              <li key={f.id} className="p-2 rounded" style={{ backgroundColor: 'var(--bg-page)' }}>
                <span>{f.signal ?? '(implicit only)'}</span>
                {f.category && <span> · {f.category}</span>}
                {f.comment && <div className="italic mt-0.5">"{f.comment}"</div>}
                {f.implicit && Object.keys(f.implicit).length > 0 && (
                  <div style={{ color: 'var(--text-secondary)' }} className="mt-0.5">
                    implicit: {JSON.stringify(f.implicit)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <div className="font-semibold mb-1">Context</div>
        <pre className="whitespace-pre-wrap text-[11px] p-2 rounded" style={{ backgroundColor: 'var(--bg-page)', color: 'var(--text-secondary)' }}>
          {JSON.stringify(data.query.context ?? {}, null, 2)}
        </pre>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
        {top && (
          <button
            type="button"
            data-testid={`mark-reviewed-${id}`}
            disabled={marking || !!top.reviewedAt}
            onClick={() => handleMarkReviewed(top.id)}
            className="px-2.5 py-1 rounded-md text-xs font-medium border"
            style={{
              borderColor:     top.reviewedAt ? 'var(--border-default)' : 'var(--color-blue-600)',
              color:           top.reviewedAt ? 'var(--text-secondary)' : 'var(--color-blue-700)',
              backgroundColor: top.reviewedAt ? 'transparent'           : 'var(--color-blue-50)',
              cursor:          top.reviewedAt || marking ? 'default' : 'pointer',
              opacity:         marking ? 0.6 : 1,
            }}
          >
            {top.reviewedAt ? 'Reviewed ✓' : (marking ? 'Marking…' : 'Mark reviewed')}
          </button>
        )}
        <Link
          to={`/admin/help/new?seedQuestion=${encodeURIComponent(data.query.text)}`}
          data-testid={`create-doc-${id}`}
          className="px-2.5 py-1 rounded-md text-xs font-medium text-white"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          + Create doc from this query
        </Link>
      </div>
    </div>
  )
}
