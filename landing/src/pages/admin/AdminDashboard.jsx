import React, { useEffect, useState } from 'react'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

function MLLimitsPanel() {
  const [limits, setLimits]   = useState(null)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [form, setForm] = useState({
    maxEpisodesPerModel: '', maxEpisodesPerSession: '', maxConcurrentSessions: '', maxModelsPerUser: '',
    dqnDefaultHiddenLayers: '32', dqnMaxHiddenLayers: '3', dqnMaxUnitsPerLayer: '256',
  })

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const { limits: l } = await api.admin.getMLLimits(token)
        setLimits(l)
        setForm({
          maxEpisodesPerModel: l.maxEpisodesPerModel,
          maxEpisodesPerSession: l.maxEpisodesPerSession,
          maxConcurrentSessions: l.maxConcurrentSessions,
          maxModelsPerUser: l.maxModelsPerUser,
          dqnDefaultHiddenLayers: (l.dqnDefaultHiddenLayers ?? [32]).join(', '),
          dqnMaxHiddenLayers: l.dqnMaxHiddenLayers ?? 3,
          dqnMaxUnitsPerLayer: l.dqnMaxUnitsPerLayer ?? 256,
        })
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
      const parsedLayers = form.dqnDefaultHiddenLayers
        .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0)
      const { limits: l } = await api.admin.setMLLimits({
        maxEpisodesPerModel: form.maxEpisodesPerModel,
        maxEpisodesPerSession: form.maxEpisodesPerSession,
        maxConcurrentSessions: form.maxConcurrentSessions,
        maxModelsPerUser: form.maxModelsPerUser,
        dqnDefaultHiddenLayers: parsedLayers.length > 0 ? parsedLayers : undefined,
        dqnMaxHiddenLayers: form.dqnMaxHiddenLayers,
        dqnMaxUnitsPerLayer: form.dqnMaxUnitsPerLayer,
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
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max episodes per model</span>
              <input
                type="number"
                min="0"
                value={form.maxEpisodesPerModel}
                onChange={e => setForm(f => ({ ...f, maxEpisodesPerModel: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max episodes per session</span>
              <input
                type="number"
                min="0"
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
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max models per user</span>
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
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border-default)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>DQN Neural Network (applies to new models only)</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Default hidden layers</span>
                <input
                  type="text"
                  placeholder='e.g. "32" or "64, 64"'
                  value={form.dqnDefaultHiddenLayers}
                  onChange={e => setForm(f => ({ ...f, dqnDefaultHiddenLayers: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none font-mono"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max hidden layers</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={form.dqnMaxHiddenLayers}
                  onChange={e => setForm(f => ({ ...f, dqnMaxHiddenLayers: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Max units per layer</span>
                <input
                  type="number"
                  min="1"
                  max="2048"
                  value={form.dqnMaxUnitsPerLayer}
                  onChange={e => setForm(f => ({ ...f, dqnMaxUnitsPerLayer: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                  style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                />
              </label>
            </div>
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

function IdleConfigPanel() {
  const [form, setForm]   = useState({ idleWarnSeconds: '', idleGraceSeconds: '', spectatorIdleSeconds: '' })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const d = await api.admin.getIdleConfig(token)
        setForm({ idleWarnSeconds: d.idleWarnSeconds, idleGraceSeconds: d.idleGraceSeconds, spectatorIdleSeconds: d.spectatorIdleSeconds })
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
      const d = await api.admin.setIdleConfig({
        idleWarnSeconds: form.idleWarnSeconds,
        idleGraceSeconds: form.idleGraceSeconds,
        spectatorIdleSeconds: form.spectatorIdleSeconds,
      }, token)
      setForm({ idleWarnSeconds: d.idleWarnSeconds, idleGraceSeconds: d.idleGraceSeconds, spectatorIdleSeconds: d.spectatorIdleSeconds })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Inactivity Timers</h2>
      <div
        className="rounded-xl border p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          All values are in seconds. Player rooms are abandoned (no result) when a player is idle too long; spectators are silently kicked.
        </p>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Idle warn (seconds)</span>
              <input
                type="number"
                min="10"
                value={form.idleWarnSeconds}
                onChange={e => setForm(f => ({ ...f, idleWarnSeconds: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Time since last move before "Still Active?" popup (default 120)</span>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Grace period (seconds)</span>
              <input
                type="number"
                min="10"
                value={form.idleGraceSeconds}
                onChange={e => setForm(f => ({ ...f, idleGraceSeconds: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Time from warning before removal if no response (default 60)</span>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Spectator idle (seconds)</span>
              <input
                type="number"
                min="10"
                value={form.spectatorIdleSeconds}
                onChange={e => setForm(f => ({ ...f, spectatorIdleSeconds: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Warn threshold for spectators; grace period reuses the value above (default 600)</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
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

function SessionIdlePanel() {
  const [form, setForm]     = useState({ idleWarnMinutes: '', idleGraceMinutes: '' })
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const token = await getToken()
        const d = await api.admin.getSessionConfig(token)
        setForm({ idleWarnMinutes: d.idleWarnMinutes, idleGraceMinutes: d.idleGraceMinutes })
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
      const d = await api.admin.setSessionConfig({
        idleWarnMinutes: form.idleWarnMinutes,
        idleGraceMinutes: form.idleGraceMinutes,
      }, token)
      setForm({ idleWarnMinutes: d.idleWarnMinutes, idleGraceMinutes: d.idleGraceMinutes })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  if (!loaded) return null

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Session Idle Timeout</h2>
      <div
        className="rounded-xl border p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          App-wide idle timeout for authenticated users on any page. Suppressed during active PvP games and Gym training. Values are in minutes.
        </p>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Idle warn (minutes)</span>
              <input
                type="number"
                min="1"
                value={form.idleWarnMinutes}
                onChange={e => setForm(f => ({ ...f, idleWarnMinutes: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Inactivity before "Still there?" popup (default 30)</span>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Grace period (minutes)</span>
              <input
                type="number"
                min="1"
                value={form.idleGraceMinutes}
                onChange={e => setForm(f => ({ ...f, idleGraceMinutes: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg border text-sm focus:outline-none"
                style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Time from warning before auto sign-out (default 5)</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
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
      <IdleConfigPanel />
      <SessionIdlePanel />

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
