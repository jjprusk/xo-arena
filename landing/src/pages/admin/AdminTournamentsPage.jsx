// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { tournamentApi } from '../../lib/tournamentApi.js'
import { getToken } from '../../lib/getToken.js'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { ListTable, ListTh, ListTd, ListTr } from '../../components/ui/ListTable.jsx'
import { ActionMenu } from '../../components/ui/ActionMenu.jsx'
import TournamentForm from '../../components/tournament/TournamentForm.jsx'

const LIMIT = 4

// ── Shared primitives ─────────────────────────────────────────────────────────

function AdminHeader({ title, subtitle }) {
  return (
    <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}
        >Admin</span>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          {title}
        </h1>
      </div>
      {subtitle && <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="w-7 h-7 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorMsg({ children }) {
  return <p className="text-sm py-2" style={{ color: 'var(--color-red-600)' }}>{children}</p>
}

/**
 * Multi-select dropdown with checkbox items. `values` is a Set of selected
 * option values; changes go through `onChange(nextSet)`. The button label
 * is derived from the selected count: "All" when empty, a single option's
 * label when exactly one is picked, "<first> +N" for more than one.
 */
function MultiSelectDropdown({ label, options, values, onChange, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handle(e) { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    function onKey(e)  { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(v) {
    const next = new Set(values)
    if (next.has(v)) next.delete(v); else next.add(v)
    onChange(next)
  }
  function clearAll() { onChange(new Set()) }

  const summary = values.size === 0
    ? 'All'
    : values.size === 1
      ? options.find(o => o.value === [...values][0])?.label ?? '1'
      : `${options.find(o => o.value === [...values][0])?.label ?? '1'} +${values.size - 1}`

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="appearance-none pl-3.5 pr-8 py-1.5 rounded-full border text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] relative"
        style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
      >
        {label}: {summary}
        <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--text-muted)' }}>
          <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 min-w-[12rem] rounded-lg border py-1 z-30 shadow-lg`}
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        >
          <button
            type="button"
            onClick={clearAll}
            className="w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-[var(--bg-surface-hover)] border-b"
            style={{ color: values.size === 0 ? 'var(--color-primary)' : 'var(--text-muted)', borderColor: 'var(--border-default)' }}
          >
            {values.size === 0 ? '✓ All' : 'All (clear)'}
          </button>
          {options.map(opt => {
            const on = values.has(opt.value)
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer transition-colors hover:bg-[var(--bg-surface-hover)]"
                style={{ color: 'var(--text-primary)' }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(opt.value)}
                  className="w-4 h-4 rounded accent-[var(--color-blue-600)]"
                />
                <span>{opt.label}</span>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ActionMenu extracted to components/ui/ActionMenu.jsx so AdminTemplatesPage
// and future admin surfaces can share one implementation.

// ── Bot Match Config ──────────────────────────────────────────────────────────

function BotMatchConfig({ token }) {
  const [config, setConfig]   = useState({ concurrencyLimit: '', defaultPaceMs: '' })
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveErr, setSaveErr] = useState(null)

  useEffect(() => {
    if (!token) return
    tournamentApi.getBotMatchConfig(token)
      .then(d => setConfig({ concurrencyLimit: d.concurrencyLimit, defaultPaceMs: d.defaultPaceMs }))
      .catch(() => {})
  }, [token])

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveErr(null)
    try {
      const d = await tournamentApi.updateBotMatchConfig({
        concurrencyLimit: Number(config.concurrencyLimit),
        defaultPaceMs: Number(config.defaultPaceMs),
      }, token)
      setConfig({ concurrencyLimit: d.concurrencyLimit, defaultPaceMs: d.defaultPaceMs })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveErr(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bot Match Configuration</p>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Concurrency Limit</label>
          <input type="number" min={1} value={config.concurrencyLimit}
            onChange={e => setConfig(c => ({ ...c, concurrencyLimit: e.target.value }))}
            className="px-2 py-1.5 rounded-lg border text-sm w-28"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Default Pace (ms)</label>
          <input type="number" min={0} value={config.defaultPaceMs}
            onChange={e => setConfig(c => ({ ...c, defaultPaceMs: e.target.value }))}
            className="px-2 py-1.5 rounded-lg border text-sm w-28"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        </div>
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {saveErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveErr}</p>}
    </div>
  )
}

// ── Bot Match Monitor ─────────────────────────────────────────────────────────

function BotMatchMonitor({ token }) {
  const [status, setStatus]   = useState({ activeCount: 0, queueDepth: 0, jobs: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const fetchStatus = useCallback(async () => {
    if (!token) return
    setLoading(true); setError(null)
    try { setStatus(await tournamentApi.getBotMatchStatus(token)) }
    catch { setError('Failed to load bot match status.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  function truncId(id) {
    if (!id) return '—'
    return id.length > 12 ? id.slice(0, 12) + '\u2026' : id
  }

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bot Match Monitor</p>
        <button onClick={fetchStatus} disabled={loading}
          className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
      {status && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Active Jobs</span>
              <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-blue-600)' }}>{status.activeCount}</span>
            </div>
            <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Queue Depth</span>
              <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>{status.queueDepth}</span>
            </div>
          </div>
          {status.jobs && status.jobs.length > 0 ? (
            <ListTable maxHeight="40vh">
              <thead>
                <tr>
                  <ListTh>Match ID</ListTh>
                  <ListTh>Tournament ID</ListTh>
                  <ListTh>Enqueued At</ListTh>
                </tr>
              </thead>
              <tbody>
                {status.jobs.map((job, i) => (
                  <ListTr key={job.matchId} last={i === status.jobs.length - 1}>
                    <ListTd><span className="font-mono text-xs" title={job.matchId}>{truncId(job.matchId)}</span></ListTd>
                    <ListTd><span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }} title={job.tournamentId}>{truncId(job.tournamentId)}</span></ListTd>
                    <ListTd><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{job.enqueuedAt ? new Date(job.enqueuedAt).toLocaleString() : '—'}</span></ListTd>
                  </ListTr>
                ))}
              </tbody>
            </ListTable>
          ) : (
            <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>No active jobs.</p>
          )}
        </>
      )}
    </div>
  )
}

// ── Classification helpers ────────────────────────────────────────────────────

const TIERS = ['RECRUIT', 'CONTENDER', 'VETERAN', 'ELITE', 'CHAMPION', 'LEGEND']
const TIER_STYLES = {
  RECRUIT:   { bg: 'var(--color-gray-100)',   text: 'var(--text-secondary)' },
  CONTENDER: { bg: 'var(--color-blue-50)',    text: 'var(--color-blue-700)' },
  VETERAN:   { bg: 'var(--color-slate-100)',  text: 'var(--color-slate-700)' },
  ELITE:     { bg: '#f3e8ff',                 text: '#7c3aed' },
  CHAMPION:  { bg: 'var(--color-amber-50)',   text: 'var(--color-amber-700)' },
  LEGEND:    { bg: '#fef9c3',                 text: '#a16207' },
}

function TierBadge({ tier }) {
  const s = TIER_STYLES[tier] ?? TIER_STYLES.RECRUIT
  return (
    <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text }}>
      {tier ?? '—'}
    </span>
  )
}

// ── Classification — Player detail modal ──────────────────────────────────────

function PlayerDetailModal({ userId, token, onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [overrideTier, setOverrideTier] = useState('')
  const [overriding, setOverriding]     = useState(false)
  const [overrideErr, setOverrideErr]   = useState(null)
  const [overrideDone, setOverrideDone] = useState(false)

  useEffect(() => {
    setLoading(true); setError(null)
    tournamentApi.getPlayerClassification(userId, token)
      .then(d => { setData(d); setOverrideTier(d.tier ?? '') })
      .catch(e => setError(e.message || 'Failed to load player.'))
      .finally(() => setLoading(false))
  }, [userId, token])

  async function handleOverride() {
    if (!overrideTier) return
    setOverriding(true); setOverrideErr(null); setOverrideDone(false)
    try {
      await tournamentApi.overridePlayerTier(userId, overrideTier, token)
      setOverrideDone(true)
      setTimeout(() => setOverrideDone(false), 2000)
      const d = await tournamentApi.getPlayerClassification(userId, token)
      setData(d); setOverrideTier(d.tier ?? '')
    } catch (e) {
      setOverrideErr(e.message || 'Override failed.')
    } finally {
      setOverriding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-2xl mt-8 mb-8 rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Player Classification
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)]"
            style={{ color: 'var(--text-muted)' }} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        {loading && <Spinner />}
        {error && <ErrorMsg>{error}</ErrorMsg>}
        {data && (
          <>
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Username</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{data.username ?? data.user?.username ?? '—'}</span>
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Current Tier</span>
                <TierBadge tier={data.tier} />
              </div>
              <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Merits</span>
                <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-blue-600)' }}>{data.merits ?? 0}</span>
              </div>
            </div>

            {data.meritHistory?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Merit History (last 20)</p>
                <ListTable maxHeight="30vh">
                  <thead><tr><ListTh>Date</ListTh><ListTh>Delta</ListTh><ListTh>Reason</ListTh><ListTh className="hidden sm:table-cell">Tournament</ListTh></tr></thead>
                  <tbody>
                    {data.meritHistory.slice(0, 20).map((h, i) => (
                      <ListTr key={i} last={i === Math.min(data.meritHistory.length, 20) - 1}>
                        <ListTd><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{h.createdAt ? new Date(h.createdAt).toLocaleDateString() : '—'}</span></ListTd>
                        <ListTd><span className="text-xs font-semibold tabular-nums" style={{ color: h.delta > 0 ? 'var(--color-slate-600)' : 'var(--color-red-600)' }}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span></ListTd>
                        <ListTd><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{h.reason ?? '—'}</span></ListTd>
                        <ListTd className="hidden sm:table-cell"><span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{h.tournamentId ? h.tournamentId.slice(0, 8) + '…' : '—'}</span></ListTd>
                      </ListTr>
                    ))}
                  </tbody>
                </ListTable>
              </div>
            )}

            {data.classificationHistory?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Classification History (last 20)</p>
                <ListTable maxHeight="25vh">
                  <thead><tr><ListTh>Date</ListTh><ListTh>Change</ListTh><ListTh>Reason</ListTh></tr></thead>
                  <tbody>
                    {data.classificationHistory.slice(0, 20).map((h, i) => (
                      <ListTr key={i} last={i === Math.min(data.classificationHistory.length, 20) - 1}>
                        <ListTd><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{h.createdAt ? new Date(h.createdAt).toLocaleDateString() : '—'}</span></ListTd>
                        <ListTd>
                          <span className="flex items-center gap-1 flex-wrap">
                            <TierBadge tier={h.fromTier} />
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>→</span>
                            <TierBadge tier={h.toTier} />
                          </span>
                        </ListTd>
                        <ListTd><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{h.reason ?? '—'}</span></ListTd>
                      </ListTr>
                    ))}
                  </tbody>
                </ListTable>
              </div>
            )}

            <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Override Tier</p>
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <select value={overrideTier} onChange={e => setOverrideTier(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border text-sm"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                  {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={handleOverride} disabled={overriding}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}>
                  {overriding ? 'Overriding…' : overrideDone ? 'Done' : 'Override'}
                </button>
              </div>
              {overrideErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{overrideErr}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Classification — Player panel ─────────────────────────────────────────────

function ClassificationPanel({ token }) {
  const [players, setPlayers]   = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [tierFilter, setTierFilter] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const PAGE_LIMIT = 50
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  const load = useCallback(async (p, tier) => {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const d = await tournamentApi.getClassificationPlayers({ page: p, limit: PAGE_LIMIT, tier: tier || undefined }, token)
      const list = Array.isArray(d) ? d : (d.players ?? d.data ?? [])
      setPlayers(list)
      setTotal(typeof d.total === 'number' ? d.total : list.length)
    } catch (e) {
      setError(e.message || 'Failed to load players.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load(page, tierFilter) }, [page, tierFilter, load])

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Player Classification</p>
        <select value={tierFilter} onChange={e => { setTierFilter(e.target.value); setPage(1) }}
          className="px-2 py-1.5 rounded-lg border text-xs"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
          <option value="">All Tiers</option>
          {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}
      {loading && <Spinner />}
      {!loading && (
        <ListTable maxHeight="55vh">
          <thead>
            <tr>
              <ListTh>Username</ListTh>
              <ListTh className="hidden sm:table-cell">Display Name</ListTh>
              <ListTh>Tier</ListTh>
              <ListTh align="right">Merits</ListTh>
              <ListTh className="hidden md:table-cell">Bot</ListTh>
            </tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <ListTr key={p.userId ?? p.id ?? i} last={i === players.length - 1} onClick={() => setSelectedId(p.userId ?? p.id)}>
                <ListTd><span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.username ?? p.user?.username ?? '—'}</span></ListTd>
                <ListTd className="hidden sm:table-cell"><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{p.displayName ?? p.user?.displayName ?? '—'}</span></ListTd>
                <ListTd><TierBadge tier={p.tier} /></ListTd>
                <ListTd align="right"><span className="text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>{p.merits ?? 0}</span></ListTd>
                <ListTd className="hidden md:table-cell">
                  {(p.isBot ?? p.user?.isBot) ? (
                    <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>Bot</span>
                  ) : <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>}
                </ListTd>
              </ListTr>
            ))}
          </tbody>
        </ListTable>
      )}
      {!loading && players.length === 0 && !error && (
        <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No players found.</p>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || loading}
            className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Prev</button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}
            className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Next</button>
        </div>
      )}
      {selectedId && <PlayerDetailModal userId={selectedId} token={token} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

// ── Merit thresholds panel ────────────────────────────────────────────────────

const DEFAULT_BANDS = [
  { bandMin: 3,  bandMax: 9,    pos1: 2, pos2: 1, pos3: 0, pos4: 0 },
  { bandMin: 10, bandMax: 19,   pos1: 3, pos2: 2, pos3: 1, pos4: 0 },
  { bandMin: 20, bandMax: 49,   pos1: 4, pos2: 3, pos3: 2, pos4: 1 },
  { bandMin: 50, bandMax: null, pos1: 5, pos2: 4, pos3: 3, pos4: 2 },
]

function MeritThresholdsPanel({ token }) {
  const [bands, setBands]     = useState(DEFAULT_BANDS)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const [loadErr, setLoadErr] = useState(null)

  useEffect(() => {
    if (!token) return
    tournamentApi.getMeritThresholds(token)
      .then(d => { const list = Array.isArray(d) ? d : (d.bands ?? d.thresholds ?? []); if (list.length > 0) setBands(list) })
      .catch(e => setLoadErr(e.message || 'Failed to load thresholds.'))
  }, [token])

  function updateBand(idx, field, value) {
    setBands(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b))
  }

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveErr(null)
    try { await tournamentApi.updateMeritThresholds(bands, token); setSaved(true); setTimeout(() => setSaved(false), 2000) }
    catch (e) { setSaveErr(e.message || 'Save failed.') }
    finally { setSaving(false) }
  }

  const inputCls = "px-2 py-1.5 rounded-lg border text-sm w-16 text-center"
  const inputStyle = { backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Merit Thresholds</p>
      {loadErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{loadErr}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>{['Band', '1st', '2nd', '3rd', '4th'].map(h => (
              <th key={h} className="text-left pb-2 pr-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {bands.map((band, idx) => (
              <tr key={idx}>
                <td className="pr-3 py-1.5 whitespace-nowrap font-mono" style={{ color: 'var(--text-muted)' }}>{band.bandMin}–{band.bandMax ?? '+'}</td>
                {['pos1', 'pos2', 'pos3', 'pos4'].map(field => (
                  <td key={field} className="pr-2 py-1.5">
                    <input type="number" min={0} value={band[field] ?? 0}
                      onChange={e => updateBand(idx, field, Number(e.target.value))}
                      className={inputCls} style={inputStyle} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={handleSave} disabled={saving}
        className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}>
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save Thresholds'}
      </button>
      {saveErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveErr}</p>}
    </div>
  )
}

// ── Classification config panel ───────────────────────────────────────────────

const CONFIG_FIELDS = [
  { key: 'classification.tiers.RECRUIT.meritsRequired',     label: 'RECRUIT merits required',             type: 'number' },
  { key: 'classification.tiers.CONTENDER.meritsRequired',   label: 'CONTENDER merits required',           type: 'number' },
  { key: 'classification.tiers.VETERAN.meritsRequired',     label: 'VETERAN merits required',             type: 'number' },
  { key: 'classification.tiers.ELITE.meritsRequired',       label: 'ELITE merits required',               type: 'number' },
  { key: 'classification.tiers.CHAMPION.meritsRequired',    label: 'CHAMPION merits required',            type: 'number' },
  { key: 'classification.demotion.finishRatioThreshold',    label: 'Finish ratio threshold',              type: 'float' },
  { key: 'classification.demotion.minQualifyingMatches',    label: 'Min qualifying matches',              type: 'number' },
  { key: 'classification.demotion.reviewCadenceDays',       label: 'Review cadence (days)',               type: 'number' },
  { key: 'classification.bestOverallBonus.minParticipants', label: 'Best overall bonus min participants', type: 'number' },
]

function ClassificationConfigPanel({ token }) {
  const [values, setValues]   = useState({})
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveErr, setSaveErr] = useState(null)
  const [loadErr, setLoadErr] = useState(null)

  useEffect(() => {
    if (!token) return
    tournamentApi.getClassificationConfig(token)
      .then(d => {
        if (d && typeof d === 'object' && !Array.isArray(d)) {
          const flat = {}
          CONFIG_FIELDS.forEach(f => { flat[f.key] = d[f.key] ?? '' })
          setValues(flat)
        }
      })
      .catch(e => setLoadErr(e.message || 'Failed to load config.'))
  }, [token])

  async function handleSave() {
    setSaving(true); setSaved(false); setSaveErr(null)
    try {
      const updates = {}
      CONFIG_FIELDS.forEach(f => { updates[f.key] = f.type === 'float' ? parseFloat(values[f.key]) : Number(values[f.key]) })
      await tournamentApi.updateClassificationConfig(updates, token)
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { setSaveErr(e.message || 'Save failed.') }
    finally { setSaving(false) }
  }

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Classification Config</p>
      {loadErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{loadErr}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CONFIG_FIELDS.map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{f.label}</label>
            <input type="number" step={f.type === 'float' ? '0.01' : '1'} min={0} value={values[f.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
          </div>
        ))}
      </div>
      <button onClick={handleSave} disabled={saving}
        className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
        style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}>
        {saving ? 'Saving…' : saved ? 'Saved' : 'Save Config'}
      </button>
      {saveErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveErr}</p>}
    </div>
  )
}

// ── Recurring registrations panel ─────────────────────────────────────────────

function RecurringRegistrations({ token }) {
  const [templateId, setTemplateId]   = useState('')
  const [registrations, setRegistrations] = useState(null)
  const [loadErr, setLoadErr]         = useState(null)
  const [loading, setLoading]         = useState(false)

  async function handleLookup() {
    if (!templateId.trim()) return
    setLoading(true); setLoadErr(null); setRegistrations(null)
    try {
      const d = await tournamentApi.listRecurringRegistrations(templateId.trim(), token)
      setRegistrations(Array.isArray(d) ? d : (d.registrations ?? d.data ?? []))
    } catch (e) { setLoadErr(e.message || 'Failed to load registrations.') }
    finally { setLoading(false) }
  }

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recurring Registrations</p>
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Look up by Template ID</label>
          <input type="text" placeholder="Recurring tournament template ID…" value={templateId}
            onChange={e => setTemplateId(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLookup()}
            className="px-2 py-1.5 rounded-lg border text-sm"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }} />
        </div>
        <button onClick={handleLookup} disabled={loading || !templateId.trim()}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}>
          {loading ? 'Loading…' : 'Look Up'}
        </button>
      </div>
      {loadErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{loadErr}</p>}
      {registrations !== null && (
        registrations.length === 0 ? (
          <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>No standing registrations for this template.</p>
        ) : (
          <ListTable maxHeight="40vh">
            <thead><tr>
              <ListTh>Template ID</ListTh><ListTh>User ID</ListTh>
              <ListTh align="right">Missed</ListTh><ListTh className="hidden sm:table-cell">Opted Out At</ListTh>
            </tr></thead>
            <tbody>
              {registrations.map((r, i) => (
                <ListTr key={r.id ?? i} last={i === registrations.length - 1}>
                  <ListTd><span className="font-mono text-xs" title={r.templateId}>{r.templateId ? r.templateId.slice(0, 12) + (r.templateId.length > 12 ? '\u2026' : '') : '—'}</span></ListTd>
                  <ListTd><span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }} title={r.userId}>{r.userId ? r.userId.slice(0, 12) + (r.userId.length > 12 ? '\u2026' : '') : '—'}</span></ListTd>
                  <ListTd align="right"><span className="text-xs tabular-nums" style={{ color: (r.missedCount ?? 0) > 0 ? 'var(--color-amber-700)' : 'var(--text-muted)' }}>{r.missedCount ?? 0}</span></ListTd>
                  <ListTd className="hidden sm:table-cell"><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.optedOutAt ? new Date(r.optedOutAt).toLocaleDateString() : '—'}</span></ListTd>
                </ListTr>
              ))}
            </tbody>
          </ListTable>
        )
      )}
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  DRAFT:               { bg: 'var(--color-gray-100)',   text: 'var(--text-muted)',      label: 'Draft' },
  REGISTRATION_OPEN:   { bg: 'var(--color-slate-100)',  text: 'var(--color-slate-700)', label: 'Open' },
  REGISTRATION_CLOSED: { bg: 'var(--color-amber-50)',   text: 'var(--color-amber-700)', label: 'Reg Closed' },
  IN_PROGRESS:         { bg: 'var(--color-blue-50)',    text: 'var(--color-blue-700)',  label: 'In Progress' },
  COMPLETED:           { bg: 'var(--color-gray-100)',   text: 'var(--text-secondary)',  label: 'Completed' },
  CANCELLED:           { bg: 'var(--color-red-50)',     text: 'var(--color-red-600)',   label: 'Cancelled' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT
  return (
    <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text }}>
      {s.label}
    </span>
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function TournamentModal({ tournament, token, onSaved, onClose }) {
  const isEdit = !!tournament

  async function handleSubmit(data) {
    if (isEdit) await tournamentApi.update(tournament.id, data, token)
    else        await tournamentApi.create(data, token)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className="relative w-full max-w-xl mt-8 mb-8 rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Tournament' : 'Create Tournament'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)]"
            style={{ color: 'var(--text-muted)' }} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        <TournamentForm initialValues={tournament} onSubmit={handleSubmit} onCancel={onClose}
          submitLabel={isEdit ? 'Save Changes' : 'Create Tournament'} />
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminTournamentsPage() {
  const { data: session, isPending } = useOptimisticSession()
  const [tournaments, setTournaments] = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)
  const [token, setToken]     = useState(null)
  const [modal, setModal]         = useState(null)
  // Multi-select status filter. Empty Set == show all. Filtering is applied
  // client-side because the list endpoint only supports a single status
  // query param and the admin page already loads + paginates in-browser.
  const [statusFilters, setStatusFilters] = useState(() => new Set())
  const [showTest, setShowTest]   = useState(false)   // default OFF
  const [purging, setPurging]     = useState(false)
  // Bulk selection — keyed by tournament id. Clears whenever the page or
  // filter changes (stale selections across filter switches would be
  // confusing and the server-side state may have moved on).
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [bulkBusy, setBulkBusy]       = useState(false)
  useEffect(() => { setSelectedIds(new Set()) }, [page, statusFilters, showTest])

  const totalPages = Math.ceil(total / LIMIT)
  const isAdmin = session?.user?.role === 'admin'

  useEffect(() => {
    getToken().then(setToken).catch(() => {})
  }, [])

  const load = useCallback(async (p, filters, withTest) => {
    if (!token) return
    setLoading(true); setError(null)
    try {
      const params = {}
      if (withTest) params.includeTest = true
      const data = await tournamentApi.list(params, token)
      let list = Array.isArray(data) ? data : (data.tournaments ?? [])
      // Multi-status filter: empty set == show all.
      if (filters && filters.size > 0) {
        list = list.filter(t => filters.has(t.status))
      }
      // Hide cancelled-before-publish drafts unless explicitly viewing Cancelled.
      // Works with multi-select: only applies when CANCELLED isn't selected.
      const viewingCancelled = filters?.has('CANCELLED')
      if (!viewingCancelled) {
        list = list.filter(t =>
          t.status !== 'CANCELLED' || (t._count?.participants ?? 0) > 0
        )
      }
      setTotal(list.length)
      const start = (p - 1) * LIMIT
      setTournaments(list.slice(start, start + LIMIT))
    } catch { setError('Failed to load tournaments.') }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { if (token) load(page, statusFilters, showTest) }, [token, page, statusFilters, showTest, load])

  if (isPending) return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-slate-400)', borderTopColor: 'transparent' }} />
    </div>
  )
  if (!isAdmin) return <Navigate to="/" replace />

  async function handlePurgeCancelled() {
    if (!confirm('Delete ALL cancelled tournaments permanently? This cannot be undone.')) return
    setPurging(true); setActionError(null)
    try {
      const { deleted } = await tournamentApi.purgeCancelled(token)
      alert(`Deleted ${deleted} cancelled tournament${deleted === 1 ? '' : 's'}.`)
      load(page, statusFilters, showTest)
    } catch (e) { setActionError(e.message || 'Purge failed.') }
    finally { setPurging(false) }
  }

  async function handlePurgeTest() {
    if (!confirm('Delete ALL test-flagged tournaments permanently? This removes every tournament with the TEST badge, regardless of status. This cannot be undone.')) return
    setPurging(true); setActionError(null)
    try {
      const { deleted } = await tournamentApi.purgeTest(token)
      alert(`Deleted ${deleted} test tournament${deleted === 1 ? '' : 's'}.`)
      load(page, statusFilters, showTest)
    } catch (e) { setActionError(e.message || 'Purge test failed.') }
    finally { setPurging(false) }
  }

  async function handleCheckRecurring() {
    setActionError(null)
    try {
      const summary = await tournamentApi.triggerRecurringCheck(token)
      const msg = `Recurring sweep: ${summary.templatesChecked} template${summary.templatesChecked === 1 ? '' : 's'} checked, ${summary.occurrencesCreated} new occurrence${summary.occurrencesCreated === 1 ? '' : 's'} created${summary.errors ? ` (${summary.errors} error${summary.errors === 1 ? '' : 's'})` : ''}.`
      alert(msg)
      load(page, statusFilters, showTest)
    } catch (e) { setActionError(e.message || 'Recurring check failed.') }
  }

  async function performAction(action, tournament, label) {
    if (!confirm(`${label} "${tournament.name}"?`)) return
    setActionError(null)
    try { await tournamentApi[action](tournament.id, token); load(page, statusFilters, showTest) }
    catch (e) { setActionError(e.message || `${label} failed.`) }
  }

  async function toggleTestFlag(tournament) {
    const next = !tournament.isTest
    const verb = next ? 'Mark as test' : 'Unmark as test'
    if (!confirm(`${verb} "${tournament.name}"?${next ? '\n\nIt will be hidden from the public tournaments page.' : ''}`)) return
    setActionError(null)
    try { await tournamentApi.update(tournament.id, { isTest: next }, token); load(page, statusFilters, showTest) }
    catch (e) { setActionError(e.message || `${verb} failed.`) }
  }

  function toggleSelected(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAllCurrent() {
    setSelectedIds(prev => {
      const allIds = tournaments.map(t => t.id)
      const allSelected = allIds.every(id => prev.has(id))
      return allSelected ? new Set() : new Set(allIds)
    })
  }

  /**
   * Apply `action` to every currently-selected tournament. `action` is one of:
   *   'publish' | 'start' | 'cancel' | 'markTest' | 'unmarkTest'.
   * Runs per-tournament in parallel; reports succeeded/skipped/failed counts.
   * 'Skipped' = tournament is not in a valid state for the action (e.g. you
   * chose Publish but the tournament is already IN_PROGRESS).
   */
  async function performBulk(action) {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    const label = {
      publish: 'Publish', start: 'Start', cancel: 'Cancel',
      markTest: 'Mark as test', unmarkTest: 'Unmark as test',
    }[action] ?? action
    if (!confirm(`${label} ${ids.length} tournament${ids.length === 1 ? '' : 's'}?`)) return

    setBulkBusy(true); setActionError(null)
    const selected = tournaments.filter(t => selectedIds.has(t.id))
    let ok = 0, skipped = 0, failed = 0
    const results = await Promise.all(selected.map(async (t) => {
      try {
        if (action === 'publish') {
          if (t.status !== 'DRAFT') return 'skip'
          await tournamentApi.publish(t.id, token)
        } else if (action === 'start') {
          if (t.status !== 'REGISTRATION_OPEN' && t.status !== 'REGISTRATION_CLOSED') return 'skip'
          await tournamentApi.start(t.id, token)
        } else if (action === 'cancel') {
          if (t.status === 'COMPLETED' || t.status === 'CANCELLED') return 'skip'
          await tournamentApi.cancel(t.id, token)
        } else if (action === 'markTest') {
          if (t.isTest) return 'skip'
          await tournamentApi.update(t.id, { isTest: true }, token)
        } else if (action === 'unmarkTest') {
          if (!t.isTest) return 'skip'
          await tournamentApi.update(t.id, { isTest: false }, token)
        }
        return 'ok'
      } catch { return 'fail' }
    }))
    for (const r of results) {
      if (r === 'ok') ok++; else if (r === 'skip') skipped++; else failed++
    }
    setBulkBusy(false)
    setSelectedIds(new Set())
    const parts = [`${ok} ${label.toLowerCase()}ed`]
    if (skipped) parts.push(`${skipped} skipped (not eligible)`)
    if (failed)  parts.push(`${failed} failed`)
    alert(parts.join(' · '))
    load(page, statusFilters, showTest)
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <AdminHeader title="Tournaments" subtitle={`${total} total`} />
        <Link
          to="/admin/templates"
          className="text-sm font-semibold underline underline-offset-2 mt-2 shrink-0"
          style={{ color: 'var(--color-blue-600)' }}
        >
          Recurring Templates →
        </Link>
      </div>

      {/* Tournament list */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status filter chips */}
          <MultiSelectDropdown
            label="Status"
            align="left"
            values={statusFilters}
            onChange={(next) => { setStatusFilters(next); setPage(1) }}
            options={[
              { label: 'Draft',       value: 'DRAFT' },
              { label: 'Open',        value: 'REGISTRATION_OPEN' },
              { label: 'Reg Closed',  value: 'REGISTRATION_CLOSED' },
              { label: 'In Progress', value: 'IN_PROGRESS' },
              { label: 'Completed',   value: 'COMPLETED' },
              { label: 'Cancelled',   value: 'CANCELLED' },
            ]}
          />
          <div className="flex items-center gap-3 shrink-0">
            <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={showTest}
                onChange={e => { setShowTest(e.target.checked); setPage(1) }}
                className="w-4 h-4 rounded accent-[var(--color-amber-600)]"
              />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Show test tournaments
              </span>
            </label>
            <button onClick={handlePurgeCancelled} disabled={purging}
              className="px-3 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--color-red-50)] disabled:opacity-40"
              style={{ borderColor: 'var(--color-red-300)', color: 'var(--color-red-600)' }}>
              {purging ? 'Purging…' : 'Purge Cancelled'}
            </button>
            <button onClick={handlePurgeTest} disabled={purging}
              className="px-3 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--color-amber-50)] disabled:opacity-40"
              style={{ borderColor: 'var(--color-amber-300)', color: 'var(--color-amber-700)' }}
              title="Permanently delete every tournament flagged as test (any status).">
              {purging ? 'Purging…' : 'Purge Test'}
            </button>
            <button onClick={handleCheckRecurring}
              className="px-3 py-2 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--color-slate-50)]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              title="Fire the recurring-occurrence scheduler now instead of waiting for the next 60s tick.">
              Check Recurring
            </button>
            <button onClick={() => setModal('create')}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-700))' }}>
              + Create Tournament
            </button>
          </div>
        </div>

        {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
        {loading && <Spinner />}
        {error && <ErrorMsg>{error}</ErrorMsg>}

        {/* Bulk-action bar — visible whenever at least one row is selected. */}
        {!loading && selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 border"
               style={{ backgroundColor: 'var(--color-blue-50)', borderColor: 'var(--color-blue-200)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--color-blue-700)' }}>
              {selectedIds.size} selected
            </span>
            <ActionMenu
              align="left"
              trigger={
                <button
                  disabled={bulkBusy}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                >
                  {bulkBusy ? 'Working…' : 'Bulk actions ▾'}
                </button>
              }
              items={[
                { label: 'Publish',         onSelect: () => performBulk('publish') },
                { label: 'Start',           onSelect: () => performBulk('start') },
                { label: 'Cancel',          onSelect: () => performBulk('cancel'), tone: 'danger' },
                { label: 'Mark as test',    onSelect: () => performBulk('markTest'),    tone: 'warn' },
                { label: 'Unmark test',     onSelect: () => performBulk('unmarkTest'),  tone: 'warn' },
              ]}
            />
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs px-2 py-1 rounded transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ color: 'var(--text-muted)' }}
            >
              Clear selection
            </button>
          </div>
        )}

        {!loading && (
          <ListTable fitViewport bottomPadding={160}>
            <thead>
              <tr>
                <ListTh>
                  <input
                    type="checkbox"
                    aria-label={tournaments.length > 0 && tournaments.every(t => selectedIds.has(t.id)) ? 'Deselect all' : 'Select all'}
                    checked={tournaments.length > 0 && tournaments.every(t => selectedIds.has(t.id))}
                    onChange={selectAllCurrent}
                    className="w-4 h-4 rounded accent-[var(--color-blue-600)]"
                  />
                </ListTh>
                <ListTh>Name</ListTh>
                <ListTh className="hidden sm:table-cell">Status</ListTh>
                <ListTh className="hidden md:table-cell">Format</ListTh>
                <ListTh className="hidden md:table-cell">Mode</ListTh>
                <ListTh align="right" className="hidden lg:table-cell">Players</ListTh>
                <ListTh className="hidden lg:table-cell">Start</ListTh>
                <ListTh align="right">Actions</ListTh>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t, i) => {
                const participantCount = t.participants?.length ?? t._count?.participants ?? 0
                const canEdit    = t.status === 'DRAFT'
                const canPublish = t.status === 'DRAFT'
                const canStart   = t.status === 'REGISTRATION_OPEN' || t.status === 'REGISTRATION_CLOSED'
                const canCancel  = t.status !== 'COMPLETED' && t.status !== 'CANCELLED'

                return (
                  <ListTr key={t.id} last={i === tournaments.length - 1}>
                    <ListTd>
                      <input
                        type="checkbox"
                        aria-label={`Select ${t.name}`}
                        checked={selectedIds.has(t.id)}
                        onChange={() => toggleSelected(t.id)}
                        className="w-4 h-4 rounded accent-[var(--color-blue-600)]"
                      />
                    </ListTd>
                    <ListTd>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to={`/tournaments/${t.id}`}
                          state={{ from: '/admin/tournaments' }}
                          className="font-medium text-sm hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {t.name}
                        </Link>
                        {t.isTest && (
                          <span
                            className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)', border: '1px solid var(--color-amber-300)' }}
                            title="Test tournament — hidden from public list"
                          >
                            Test
                          </span>
                        )}
                      </div>
                      {t.description && (
                        <p className="text-[10px] truncate max-w-[180px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                      )}
                    </ListTd>
                    <ListTd className="hidden sm:table-cell">
                      <div className="flex flex-col gap-0.5 items-start">
                        <StatusBadge status={t.status} />
                        {t.format && t.format !== 'PLANNED' && (
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {t.status === 'IN_PROGRESS' && t.format === 'FLASH' ? '⚡ Flash' : t.format}
                          </span>
                        )}
                      </div>
                    </ListTd>
                    <ListTd className="hidden md:table-cell"><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.bracketType?.replace('_', ' ')}</span></ListTd>
                    <ListTd className="hidden md:table-cell"><span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.mode}</span></ListTd>
                    <ListTd align="right" className="hidden lg:table-cell">
                      <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>
                        {participantCount}{t.maxParticipants ? `/${t.maxParticipants}` : ''}
                      </span>
                    </ListTd>
                    <ListTd className="hidden lg:table-cell">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t.startTime ? new Date(t.startTime).toLocaleString() : '—'}</span>
                    </ListTd>
                    <ListTd align="right">
                      <ActionMenu
                        align="right"
                        trigger={
                          <button
                            className="text-sm px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                            aria-label="Tournament actions"
                            title="Actions"
                          >
                            ⋯
                          </button>
                        }
                        items={[
                          t.status !== 'DRAFT' && { label: 'View',    href: `/tournaments/${t.id}`, state: { from: '/admin/tournaments' } },
                          canEdit                && { label: 'Edit',    onSelect: () => setModal({ tournament: t }) },
                          canPublish             && { label: 'Publish', onSelect: () => performAction('publish', t, 'Publish') },
                          canStart               && { label: 'Start',   onSelect: () => performAction('start',   t, 'Start') },
                          canCancel              && { label: 'Cancel',  onSelect: () => performAction('cancel',  t, 'Cancel'), tone: 'danger' },
                          { label: t.isTest ? 'Unmark test' : 'Mark as test', onSelect: () => toggleTestFlag(t), tone: 'warn' },
                        ]}
                      />
                    </ListTd>
                  </ListTr>
                )
              })}
            </tbody>
          </ListTable>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Prev</button>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>Next</button>
          </div>
        )}
      </div>

      {/* Bot match */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Bot Matches</h2>
        <BotMatchConfig token={token} />
        <BotMatchMonitor token={token} />
      </div>

      {/* Classification */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Classification</h2>
        <ClassificationPanel token={token} />
        <MeritThresholdsPanel token={token} />
        <ClassificationConfigPanel token={token} />
      </div>

      {/* Recurring */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Recurring Registrations</h2>
        <RecurringRegistrations token={token} />
      </div>

      {modal && (
        <TournamentModal
          tournament={modal === 'create' ? null : modal.tournament}
          token={token}
          onSaved={() => { setModal(null); load(page, statusFilters, showTest) }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
