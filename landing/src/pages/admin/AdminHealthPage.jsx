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
        </>
      )}
    </div>
  )
}
