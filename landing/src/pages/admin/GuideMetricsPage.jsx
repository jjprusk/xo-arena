// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 5 — Intelligent Guide v1 admin dashboard.
 *
 * Renders the v1 metric set from GET /api/v1/admin/guide-metrics:
 *  - North Star: % of users (signed up >=30 days ago) whose bot played
 *    a tournament match within 30 days of signup, with a 30-day trend line
 *  - 7-step funnel completion + drop-off per step
 *  - Signup-method split (credential vs OAuth) for the last 30 days
 *  - Footer: "excluding N test users"
 *
 * Recharts is already a dependency (see landing/package.json) — used for
 * the trend line. Funnel + signup are simple flex bars (no chart library
 * needed).
 *
 * Auth gate is the parent <AdminRoute>; this component just fetches +
 * renders.
 */
import React, { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'

const STEP_LABELS = {
  step1: '1. Play a quick game',
  step2: '2. Watch two bots',
  step3: '3. Create a bot',
  step4: '4. Train your bot',
  step5: '5. Spar match',
  step6: '6. Enter tournament',
  step7: '7. See result',
}

function formatPct(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return `${(v * 100).toFixed(1)}%`
}

function formatYmd(date) {
  const d = date instanceof Date ? date : new Date(date)
  return d.toISOString().slice(0, 10)
}

// ── Section: North Star + trend ──────────────────────────────────────────────

function NorthStarPanel({ now, history }) {
  const trend = history
    .filter(r => r.metric === 'northStar')
    .map(r => ({ date: formatYmd(r.date), value: Number((r.value * 100).toFixed(2)) }))

  const ns = now?.northStar
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        North Star — Bot played a tournament within 30 days
      </h2>
      <div
        className="rounded-xl border p-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex items-baseline gap-3">
          <span
            className="text-4xl font-bold"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-teal-600)' }}
          >
            {ns ? formatPct(ns.value) : '—'}
          </span>
          {ns && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {ns.numer} / {ns.denom} eligible users
            </span>
          )}
        </div>
        <div className="mt-3" style={{ height: 160 }}>
          {trend.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--text-muted)' }}>
              No history yet — trend line populates after the first daily snapshot.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} unit="%" />
                <Tooltip formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="value" stroke="var(--color-teal-600)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  )
}

// ── Section: 7-step funnel ───────────────────────────────────────────────────

function FunnelPanel({ now }) {
  const f = now?.funnel
  // Drop-off per step relative to step 1 — most useful framing for an
  // onboarding funnel. Renders an empty state when no history yet.
  const baseline = f?.step1 || 0

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        Curriculum funnel — completion per step
      </h2>
      <div
        className="rounded-xl border p-4 space-y-2"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        {!f ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Snapshot data unavailable.
          </p>
        ) : Object.entries(STEP_LABELS).map(([key, label], i) => {
          const count = f[key] ?? 0
          const pct   = baseline > 0 ? count / baseline : 0
          const drop  = i > 0 ? (f[`step${i}`] ?? 0) - count : 0
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-xs w-44" style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <div className="flex-1 h-5 rounded relative" style={{ backgroundColor: 'var(--bg-base)' }}>
                <div
                  className="absolute inset-y-0 left-0 rounded"
                  style={{
                    width: `${Math.max(2, pct * 100)}%`,
                    backgroundColor: 'var(--color-blue-500)',
                  }}
                />
                <span className="absolute inset-0 flex items-center justify-end pr-2 text-[11px] font-mono" style={{ color: 'var(--text-primary)' }}>
                  {count}
                </span>
              </div>
              <span className="text-[10px] w-16 text-right font-mono" style={{ color: 'var(--text-muted)' }}>
                {i === 0 ? '—' : drop > 0 ? `−${drop}` : '0'}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Section: signup-method split ─────────────────────────────────────────────

function SignupSplitPanel({ now }) {
  const s = now?.signup
  const total = s ? s.credential + s.oauth : 0
  const credPct  = total > 0 ? s.credential / total : 0
  const oauthPct = total > 0 ? s.oauth / total      : 0
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        Signup method — last 30 days
      </h2>
      <div
        className="rounded-xl border p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        {!s ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Snapshot data unavailable.</p>
        ) : total === 0 ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No signups in the last 30 days.</p>
        ) : (
          <>
            <div className="h-6 rounded overflow-hidden flex">
              <div style={{ width: `${credPct * 100}%`,  backgroundColor: 'var(--color-blue-500)' }} />
              <div style={{ width: `${oauthPct * 100}%`, backgroundColor: 'var(--color-amber-500)' }} />
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-block w-2 h-2 mr-1 rounded" style={{ backgroundColor: 'var(--color-blue-500)' }} />
                Credential: {s.credential} ({formatPct(credPct)})
              </span>
              <span style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-block w-2 h-2 mr-1 rounded" style={{ backgroundColor: 'var(--color-amber-500)' }} />
                OAuth: {s.oauth} ({formatPct(oauthPct)})
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function GuideMetricsPage() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const token = await getToken()
        const res   = await api.admin.guideMetrics(token)
        if (!cancelled) setData(res)
      } catch {
        if (!cancelled) setError('Failed to load metrics.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <AdminHeader title="Guide metrics" subtitle="Intelligent Guide v1 — North Star, funnel, signup split" />
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}
      {data && (
        <>
          <NorthStarPanel now={data.now} history={data.history ?? []} />
          <FunnelPanel    now={data.now} />
          <SignupSplitPanel now={data.now} />
          <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            Excluding {data.now?.testUserCount ?? 0} test users.
          </p>
        </>
      )}
    </div>
  )
}
