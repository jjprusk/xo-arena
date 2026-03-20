import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api.js'

async function getToken() {
  return window.Clerk?.session?.getToken() ?? null
}

function MLLimitsPanel() {
  const [limits, setLimits]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [form, setForm]       = useState({ maxEpisodesPerSession: '', maxConcurrentSessions: '', maxModelsPerUser: '' })

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const { limits: l } = await api.admin.getMLLimits(token)
        setLimits(l)
        setForm({ maxEpisodesPerSession: l.maxEpisodesPerSession, maxConcurrentSessions: l.maxConcurrentSessions, maxModelsPerUser: l.maxModelsPerUser })
      } catch { /* non-fatal */ }
    }
    load()
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      const token = await getToken()
      const { limits: l } = await api.admin.setMLLimits({
        maxEpisodesPerSession: form.maxEpisodesPerSession,
        maxConcurrentSessions: form.maxConcurrentSessions,
        maxModelsPerUser: form.maxModelsPerUser,
      }, token)
      setLimits(l)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  if (!limits) return null

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>ML Training Limits</h2>
      <div
        className="rounded-xl border p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Set to <strong>0</strong> for no limit. Changes take effect on the next training session.
        </p>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max episodes per session</span>
              <input
                type="number"
                min="0"
                max="100000"
                value={form.maxEpisodesPerSession}
                onChange={e => setForm(f => ({ ...f, maxEpisodesPerSession: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max concurrent sessions</span>
              <input
                type="number"
                min="0"
                max="20"
                value={form.maxConcurrentSessions}
                onChange={e => setForm(f => ({ ...f, maxConcurrentSessions: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Default model limit per user</span>
              <input
                type="number"
                min="0"
                value={form.maxModelsPerUser}
                onChange={e => setForm(f => ({ ...f, maxModelsPerUser: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
            >
              {saving ? 'Saving…' : 'Save limits'}
            </button>
            {saved && <span className="text-xs font-semibold" style={{ color: 'var(--color-teal-600)' }}>✓ Saved</span>}
          </div>
        </form>
      </div>
    </section>
  )
}

function LogRetentionPanel() {
  const [maxEntries, setMaxEntries] = useState('')
  const [saving, setSaving]         = useState(false)
  const [saved, setSaved]           = useState(false)
  const [loaded, setLoaded]         = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const res = await api.admin.getLogLimit(token)
        setMaxEntries(res.maxEntries)
        setLoaded(true)
      } catch { /* non-fatal */ }
    }
    load()
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      const token = await getToken()
      const res = await api.admin.setLogLimit({ maxEntries }, token)
      setMaxEntries(res.maxEntries)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Log Retention</h2>
      <div
        className="rounded-xl border p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Maximum number of log entries to keep. Set to <strong>0</strong> for no limit.
          When the limit is reached the oldest entries are automatically removed.
        </p>
        <form onSubmit={handleSave} className="flex items-end gap-3">
          <label className="space-y-1 flex-1">
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max log entries</span>
            <input
              type="number"
              min="0"
              value={maxEntries}
              onChange={e => setMaxEntries(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
          </label>
          <div className="flex items-center gap-3 pb-0.5">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded-lg text-sm font-medium text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && <span className="text-xs font-semibold" style={{ color: 'var(--color-teal-600)' }}>✓ Saved</span>}
          </div>
        </form>
      </div>
    </section>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const { stats: s } = await api.admin.stats(token)
        setStats(s)
      } catch {
        setError('Failed to load stats.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <AdminHeader title="Admin" subtitle="Platform overview" />

      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatTile label="Total Users"  value={stats.totalUsers} />
          <StatTile label="Total Games"  value={stats.totalGames} />
          <StatTile label="Games Today"  value={stats.gamesToday}  color="var(--color-teal-600)" />
          <StatTile label="Banned Users" value={stats.bannedUsers} color={stats.bannedUsers > 0 ? 'var(--color-red-600)' : undefined} />
          <StatTile label="ML Models"    value={stats.totalModels} color="var(--color-amber-600)" />
        </div>
      )}

      <MLLimitsPanel />
      <LogRetentionPanel />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Quick links</h2>
        <div className="grid grid-cols-2 gap-2">
          {[
            { to: '/admin/users',  label: 'User Management', desc: 'Search, ban, adjust ELO' },
            { to: '/admin/games',  label: 'Game Log',         desc: 'All games across all users' },
            { to: '/admin/ml-models', label: 'ML Models',      desc: 'All models, owners, feature & delete' },
            { to: '/admin/ai',     label: 'AI Metrics',       desc: 'Move timing & heatmaps' },
            { to: '/admin/logs',   label: 'Log Viewer',       desc: 'Frontend & API logs' },
          ].map(({ to, label, desc }) => (
            <Link
              key={to}
              to={to}
              className="rounded-xl border p-4 transition-colors hover:bg-[var(--bg-surface-hover)] no-underline"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function StatTile({ label, value, color }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: color || 'var(--text-primary)' }}>
        {value ?? '—'}
      </div>
      <div className="text-xs mt-1 font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

export function AdminHeader({ title, subtitle }) {
  return (
    <div className="pb-4 border-b flex items-end justify-between" style={{ borderColor: 'var(--border-default)' }}>
      <div>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>{title}</h1>
        {subtitle && <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
      </div>
      <span
        className="text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mb-1"
        style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}
      >
        Admin
      </span>
    </div>
  )
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

export function ErrorMsg({ children }) {
  return <p className="text-sm text-center py-4" style={{ color: 'var(--color-red-600)' }}>{children}</p>
}
