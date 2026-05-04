// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'

const POLL_INTERVAL_MS = 15_000

const COUNTER_LABELS = {
  sockets:            'Sockets',
  redisConnections:   'Redis Connections',
  memoryMb:           'Heap Used (MB)',
  heapTotalMb:        'Heap Total (MB)',
  rssMb:              'RSS (MB)',
  // Phase 3.2 — Tables instrumentation
  tablesForming:      'Tables Forming',
  tablesActive:       'Tables Active',
  tablesCompleted:    'Tables Completed',
  tablesStaleForming: 'Tables Stale (>30m)',
  tableWatchers:      'Table Watchers',
}

function counterStatus(key, alerts, history) {
  if (alerts?.[key]) return 'red'
  if (history && history.length >= 2) {
    const last2 = history.slice(-2)
    if (last2[1][key] > last2[0][key]) return 'amber'
  }
  return 'green'
}

const STATUS_COLORS = {
  green: { dot: 'var(--color-teal-600)',  label: 'Stable'  },
  amber: { dot: 'var(--color-amber-600)', label: 'Rising'  },
  red:   { dot: 'var(--color-red-600)',   label: 'Leaking' },
}

function CounterTile({ label, value, status }) {
  const { dot, label: statusLabel } = STATUS_COLORS[status]
  return (
    <div
      className="rounded-xl border p-4 space-y-1"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: status === 'red' ? 'var(--color-red-500)' : 'var(--border-default)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span className="flex items-center gap-1 text-xs font-medium" style={{ color: dot }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dot, display: 'inline-block' }} />
          {statusLabel}
        </span>
      </div>
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
        {value ?? '—'}
      </div>
    </div>
  )
}

function HistoryTable({ history }) {
  if (!history || history.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No snapshots yet — first snapshot fires 60 s after backend start.</p>
  }

  const keys = [
    'sockets', 'redisConnections',
    'memoryMb', 'heapTotalMb', 'rssMb',
    'tablesForming', 'tablesActive', 'tablesCompleted',
    'tablesStaleForming', 'tableWatchers',
  ]
  const rows = [...history].reverse()

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
            <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--text-muted)' }}>Time</th>
            {keys.map(k => (
              <th key={k} className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>
                {COUNTER_LABELS[k]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((snap, i) => {
            const prev = rows[i + 1]
            return (
              <tr
                key={snap.ts}
                className="border-t"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
              >
                <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {new Date(snap.ts).toLocaleTimeString()}
                </td>
                {keys.map(k => {
                  const rose = prev && snap[k] > prev[k]
                  return (
                    <td
                      key={k}
                      className="px-3 py-1.5 text-right tabular-nums font-mono"
                      style={{ color: rose ? 'var(--color-amber-600)' : 'var(--text-primary)' }}
                    >
                      {snap[k]}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Web Vitals (RUM) ─────────────────────────────────────────────────────────

const VITAL_ORDER = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB']

// Web Vitals thresholds — https://web.dev/articles/vitals
// (good ≤, poor >). Anything between is "needs improvement".
const VITAL_THRESHOLDS = {
  FCP:  { good: 1800, poor: 3000, unit: 'ms' },
  LCP:  { good: 2500, poor: 4000, unit: 'ms' },
  INP:  { good: 200,  poor: 500,  unit: 'ms' },
  TTFB: { good: 800,  poor: 1800, unit: 'ms' },
  CLS:  { good: 0.1,  poor: 0.25, unit: ''   },
}

// Hover legend for the metric column. Keep these terse — `title` attribute
// shows them as native browser tooltips.
const VITAL_DESCRIPTIONS = {
  LCP:  'Largest Contentful Paint — time until the largest visible element renders. Loading speed. Good ≤ 2.5s, Poor > 4s.',
  INP:  'Interaction to Next Paint — worst latency from a click/tap/keypress to the next visual update. Interactivity. Good ≤ 200ms, Poor > 500ms.',
  CLS:  'Cumulative Layout Shift — sum of unexpected layout shifts during the session (unitless). Visual stability. Good ≤ 0.1, Poor > 0.25.',
  FCP:  'First Contentful Paint — time until the first text or image renders. Earliest visible feedback. Good ≤ 1.8s, Poor > 3s.',
  TTFB: 'Time to First Byte — time from request start to first byte of the response. Backend responsiveness. Good ≤ 800ms, Poor > 1.8s.',
}

// Hover legend for the percentile columns + auxiliary columns.
const COLUMN_DESCRIPTIONS = {
  Route:  'URL pathname the sample was captured on (sessionPath at the moment the metric was recorded).',
  Metric: 'Web Vital name. Hover the metric label in each row for what it measures.',
  n:      'Sample count — how many beacon entries contributed to this row.',
  p50:    'Median — half of sessions saw a worse value than this. The "typical" experience.',
  p75:    '75th percentile — 75% of sessions are at or below this value. Google\'s Core Web Vitals threshold is defined at p75.',
  p95:    '95th percentile — only the worst 5% of sessions were slower than this. The tail; catches slow networks, cold caches, slow devices.',
  Mix:    'Distribution bar — green/amber/red proportions of "good" / "needs improvement" / "poor" samples. Hover the bar for raw counts.',
}

function rateValue(name, value) {
  if (value == null) return 'unknown'
  const t = VITAL_THRESHOLDS[name]
  if (!t) return 'unknown'
  if (value <= t.good) return 'good'
  if (value > t.poor)  return 'poor'
  return 'needs'
}

const RATING_COLORS = {
  good:    'var(--color-teal-600)',
  needs:   'var(--color-amber-600)',
  poor:    'var(--color-red-600)',
  unknown: 'var(--text-muted)',
}

function fmtVitalValue(name, value) {
  if (value == null) return '—'
  if (name === 'CLS') return value.toFixed(3)
  if (value >= 1000)  return `${(value / 1000).toFixed(2)}s`
  return `${Math.round(value)}ms`
}

function VitalCell({ name, value }) {
  const rating = rateValue(name, value)
  return (
    <td
      className="px-3 py-1.5 text-right tabular-nums font-mono"
      style={{ color: RATING_COLORS[rating], fontWeight: rating === 'poor' ? 600 : 400 }}
    >
      {fmtVitalValue(name, value)}
    </td>
  )
}

function RatingBar({ good, needs, poor }) {
  const total = good + needs + poor
  if (total === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const pct = (n) => `${Math.round((n / total) * 100)}%`
  return (
    <div className="flex h-2 w-24 rounded overflow-hidden" title={`${good}/${needs}/${poor} (good/needs/poor)`}>
      <div style={{ width: pct(good),  backgroundColor: RATING_COLORS.good }} />
      <div style={{ width: pct(needs), backgroundColor: RATING_COLORS.needs }} />
      <div style={{ width: pct(poor),  backgroundColor: RATING_COLORS.poor }} />
    </div>
  )
}

function VitalsTable({ data }) {
  if (!data?.routes?.length) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        No vitals recorded in this window. The beacon ships from
        <code className="mx-1 px-1 rounded" style={{ backgroundColor: 'var(--bg-surface-hover)' }}>landing/src/lib/rum.js</code>
        on <code>pagehide</code> / visibilityHidden — open a tab and close it to seed.
      </p>
    )
  }
  // Hoverable header — dotted-underline cue tells readers there's a tooltip.
  const helpStyle = {
    color: 'var(--text-muted)',
    cursor: 'help',
    textDecoration: 'underline dotted',
    textUnderlineOffset: '3px',
  }
  const Hdr = ({ children, label, align = 'left' }) => (
    <th
      className={`px-3 py-2 text-${align} font-semibold`}
      style={helpStyle}
      title={COLUMN_DESCRIPTIONS[label]}
    >
      {children}
    </th>
  )
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
      <table className="w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
            <Hdr label="Route">Route</Hdr>
            <Hdr label="Metric">Metric</Hdr>
            <Hdr label="n"   align="right">n</Hdr>
            <Hdr label="p50" align="right">p50</Hdr>
            <Hdr label="p75" align="right">p75</Hdr>
            <Hdr label="p95" align="right">p95</Hdr>
            <Hdr label="Mix">Mix</Hdr>
          </tr>
        </thead>
        <tbody>
          {data.routes.map(({ route, metrics }) => {
            const presentNames = VITAL_ORDER.filter(n => metrics[n])
            return presentNames.map((name, i) => {
              const m = metrics[name]
              return (
                <tr
                  key={`${route}::${name}`}
                  className="border-t"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
                >
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {i === 0 ? route : ''}
                  </td>
                  <td
                    className="px-3 py-1.5 font-medium"
                    style={{
                      color: 'var(--text-primary)',
                      cursor: 'help',
                      textDecoration: 'underline dotted',
                      textUnderlineOffset: '3px',
                    }}
                    title={VITAL_DESCRIPTIONS[name]}
                  >{name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-mono" style={{ color: 'var(--text-secondary)' }}>{m.count}</td>
                  <VitalCell name={name} value={m.p50} />
                  <VitalCell name={name} value={m.p75} />
                  <VitalCell name={name} value={m.p95} />
                  <td className="px-3 py-1.5">
                    <RatingBar good={m.good} needs={m.needs} poor={m.poor} />
                  </td>
                </tr>
              )
            })
          })}
        </tbody>
      </table>
    </div>
  )
}

function PerfVitalsSection() {
  const [windowKey, setWindowKey] = useState('24h')
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      const result = await api.admin.getPerfVitals(token, { window: windowKey })
      setData(result)
      setError(null)
    } catch {
      setError('Failed to load Web Vitals.')
    } finally {
      setLoading(false)
    }
  }, [windowKey])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Real-User Web Vitals
          {data && (
            <span className="ml-2 font-normal normal-case tracking-normal" style={{ color: 'var(--text-secondary)' }}>
              · {data.totalRows} samples ·{' '}
              {Object.entries(data.byEnv).map(([env, n], i, arr) => (
                <span key={env}>
                  {env} {n}{i < arr.length - 1 ? ', ' : ''}
                </span>
              ))}
            </span>
          )}
        </h2>
        <div className="flex gap-1" role="tablist" aria-label="Time window">
          {['1h', '24h', '7d'].map(w => (
            <button
              key={w}
              onClick={() => setWindowKey(w)}
              className="px-2 py-1 text-xs rounded border"
              style={{
                backgroundColor: windowKey === w ? 'var(--color-blue-600)' : 'var(--bg-surface)',
                color:           windowKey === w ? 'white'                : 'var(--text-secondary)',
                borderColor:     windowKey === w ? 'var(--color-blue-600)' : 'var(--border-default)',
              }}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}
      {!loading && !error && data && <VitalsTable data={data} />}
    </section>
  )
}

// ── Perf Baselines (dev-only) ────────────────────────────────────────────────

function fmtBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function fmtTimestamp(t) {
  if (!t) return '—'
  // Filenames use `-` between time parts (`14-04-52-644Z`) so `new Date()`
  // can't parse them. Prettify by replacing the time-segment dashes with `:`.
  const fixed = t.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
  const d = new Date(fixed)
  if (isNaN(d.getTime())) return t
  return d.toLocaleString()
}

function PerfBaselinesSection() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selected, setSelected]     = useState(null)
  const [content, setContent]       = useState(null)
  const [contentLoading, setCL]     = useState(false)
  const [kindFilter, setKindFilter] = useState('all')

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      const result = await api.admin.listPerfBaselines(token)
      setData(result)
      setError(null)
    } catch {
      setError('Failed to load baselines.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const open = useCallback(async (filename) => {
    setSelected(filename)
    setContent(null)
    setCL(true)
    try {
      const token = await getToken()
      const result = await api.admin.getPerfBaseline(filename, token)
      setContent(result.content)
    } catch {
      setContent({ error: 'Failed to fetch baseline content.' })
    } finally {
      setCL(false)
    }
  }, [])

  if (loading) return <Spinner />
  if (error)   return <ErrorMsg>{error}</ErrorMsg>
  if (!data)   return null

  if (!data.enabled) {
    return (
      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Perf Baselines</h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Disabled in this environment ({data.error ?? 'PERF_BASELINES_DIR not set'}).
          Available in local dev — run a script under <code>perf/</code> to seed.
        </p>
      </section>
    )
  }

  const kinds  = Array.from(new Set(data.files.map(f => f.kind))).sort()
  const filtered = kindFilter === 'all' ? data.files : data.files.filter(f => f.kind === kindFilter)

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Perf Baselines
          <span className="ml-2 font-normal normal-case tracking-normal" style={{ color: 'var(--text-secondary)' }}>
            · {data.files.length} files in <code>{data.dir}</code>
          </span>
        </h2>
        <select
          value={kindFilter}
          onChange={e => setKindFilter(e.target.value)}
          className="text-xs px-2 py-1 rounded border"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          <option value="all">All kinds</option>
          {kinds.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No baseline JSONs found{kindFilter === 'all' ? '' : ` for kind="${kindFilter}"`}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border-default)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-surface-hover)' }}>
                <th className="px-3 py-2 text-left font-semibold"  style={{ color: 'var(--text-muted)' }}>Kind</th>
                <th className="px-3 py-2 text-left font-semibold"  style={{ color: 'var(--text-muted)' }}>Env</th>
                <th className="px-3 py-2 text-left font-semibold"  style={{ color: 'var(--text-muted)' }}>Captured</th>
                <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}>Size</th>
                <th className="px-3 py-2 text-right font-semibold" style={{ color: 'var(--text-muted)' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr
                  key={f.filename}
                  className="border-t"
                  style={{
                    borderColor: 'var(--border-default)',
                    backgroundColor: selected === f.filename ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
                  }}
                >
                  <td className="px-3 py-1.5 font-medium" style={{ color: 'var(--text-primary)' }}>{f.kind}</td>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-secondary)' }}>{f.env ?? '—'}</td>
                  <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtTimestamp(f.timestamp)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-mono" style={{ color: 'var(--text-secondary)' }}>{fmtBytes(f.sizeBytes)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => open(f.filename)}
                      className="text-xs px-2 py-0.5 rounded border"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-default)',
                        color: 'var(--color-blue-600)',
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div
          className="rounded-lg border p-3 space-y-2"
          style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{selected}</span>
            <button
              type="button"
              onClick={() => { setSelected(null); setContent(null) }}
              className="text-xs px-2 py-0.5 rounded border"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-default)',
                color: 'var(--text-secondary)',
              }}
            >
              Close
            </button>
          </div>
          {contentLoading ? (
            <Spinner />
          ) : (
            <pre
              className="overflow-x-auto text-xs leading-relaxed font-mono p-2 rounded"
              style={{ backgroundColor: 'var(--bg-page)', color: 'var(--text-primary)', maxHeight: 480 }}
            >
              {JSON.stringify(content, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  )
}

export default function AdminHealthPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      const result = await api.admin.getHealth(token)
      setData(result)
      setError(null)
    } catch {
      setError('Failed to load health data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [load])

  const anyAlert = data?.alerts && Object.values(data.alerts).some(Boolean)
  const alertKeys = data?.alerts ? Object.entries(data.alerts).filter(([, v]) => v).map(([k]) => COUNTER_LABELS[k]) : []

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <AdminHeader
        title="Resource Health"
        subtitle={data ? `Uptime ${Math.floor(data.uptime / 3600)}h ${Math.floor((data.uptime % 3600) / 60)}m — polling every 15 s` : 'Live resource counters'}
      />

      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {anyAlert && (
        <div
          className="rounded-xl border px-4 py-3 text-sm font-medium"
          style={{
            backgroundColor: 'var(--color-red-50)',
            borderColor: 'var(--color-red-500)',
            color: 'var(--color-red-700)',
          }}
        >
          Resource leak detected: {alertKeys.join(', ')} {alertKeys.length === 1 ? 'is' : 'are'} continuously climbing.
          Check the backend logs for details.
        </div>
      )}

      {data && (
        <>
          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Current Counters</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Object.keys(COUNTER_LABELS).map(key => (
                <CounterTile
                  key={key}
                  label={COUNTER_LABELS[key]}
                  value={data.latest?.[key] ?? '—'}
                  status={counterStatus(key, data.alerts, data.history)}
                />
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
              Snapshot History ({data.history?.length ?? 0} of 20)
            </h2>
            <HistoryTable history={data.history} />
          </section>

          <PerfVitalsSection />
          <PerfBaselinesSection />
        </>
      )}
    </div>
  )
}
