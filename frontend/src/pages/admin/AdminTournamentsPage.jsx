// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { tournamentApi } from '../../lib/tournamentApi.js'
import { AdminHeader, Spinner, ErrorMsg } from './AdminDashboard.jsx'
import { getToken } from '../../lib/getToken.js'
import {
  ListTable, ListTh, ListTd, ListTr,
  ListPagination,
} from '../../components/ui/ListTable.jsx'
import TournamentForm from '../../components/tournament/TournamentForm.jsx'

const LIMIT = 25

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
    setSaving(true)
    setSaved(false)
    setSaveErr(null)
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
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bot Match Configuration</p>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Concurrency Limit</label>
          <input
            type="number"
            min={1}
            value={config.concurrencyLimit}
            onChange={e => setConfig(c => ({ ...c, concurrencyLimit: e.target.value }))}
            className="px-2 py-1.5 rounded-lg border text-sm w-28"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Default Pace (ms)</label>
          <input
            type="number"
            min={0}
            value={config.defaultPaceMs}
            onChange={e => setConfig(c => ({ ...c, defaultPaceMs: e.target.value }))}
            className="px-2 py-1.5 rounded-lg border text-sm w-28"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          />
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </div>
      {saveErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveErr}</p>}
    </div>
  )
}

// ── Bot Match Monitor ─────────────────────────────────────────────────────────

function BotMatchMonitor({ token }) {
  const [status, setStatus]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const fetchStatus = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const d = await tournamentApi.getBotMatchStatus(token)
      setStatus(d)
    } catch {
      setError('Failed to load bot match status.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, 10000)
    return () => clearInterval(id)
  }, [fetchStatus])

  function truncId(id) {
    if (!id) return '—'
    return id.length > 12 ? id.slice(0, 12) + '\u2026' : id
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bot Match Monitor</p>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{error}</p>}

      {status && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div
              className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            >
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Active Jobs</span>
              <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-blue-600)' }}>{status.activeCount}</span>
            </div>
            <div
              className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            >
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Queue Depth</span>
              <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-teal-600)' }}>{status.queueDepth}</span>
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
                    <ListTd>
                      <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }} title={job.matchId}>
                        {truncId(job.matchId)}
                      </span>
                    </ListTd>
                    <ListTd>
                      <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }} title={job.tournamentId}>
                        {truncId(job.tournamentId)}
                      </span>
                    </ListTd>
                    <ListTd>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {job.enqueuedAt ? new Date(job.enqueuedAt).toLocaleString() : '—'}
                      </span>
                    </ListTd>
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
  RECRUIT:   { bg: 'var(--color-gray-100)',    text: 'var(--text-secondary)' },
  CONTENDER: { bg: 'var(--color-blue-50)',     text: 'var(--color-blue-700)' },
  VETERAN:   { bg: 'var(--color-teal-50)',     text: 'var(--color-teal-700)' },
  ELITE:     { bg: '#f3e8ff',                  text: '#7c3aed' },
  CHAMPION:  { bg: 'var(--color-amber-50)',    text: 'var(--color-amber-700)' },
  LEGEND:    { bg: '#fef9c3',                  text: '#a16207' },
}

function TierBadge({ tier }) {
  const s = TIER_STYLES[tier] ?? TIER_STYLES.RECRUIT
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
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
    setLoading(true)
    setError(null)
    tournamentApi.getPlayerClassification(userId, token)
      .then(d => { setData(d); setOverrideTier(d.tier ?? '') })
      .catch(e => setError(e.message || 'Failed to load player.'))
      .finally(() => setLoading(false))
  }, [userId, token])

  async function handleOverride() {
    if (!overrideTier) return
    setOverriding(true)
    setOverrideErr(null)
    setOverrideDone(false)
    try {
      await tournamentApi.overridePlayerTier(userId, overrideTier, token)
      setOverrideDone(true)
      setTimeout(() => setOverrideDone(false), 2000)
      // Refresh
      const d = await tournamentApi.getPlayerClassification(userId, token)
      setData(d)
      setOverrideTier(d.tier ?? '')
    } catch (e) {
      setOverrideErr(e.message || 'Override failed.')
    } finally {
      setOverriding(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full max-w-2xl mt-8 mb-8 rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Player Classification
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>

        {loading && <Spinner />}
        {error && <ErrorMsg>{error}</ErrorMsg>}

        {data && (
          <>
            {/* Summary */}
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

            {/* Merit history */}
            {data.meritHistory && data.meritHistory.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Merit History (last 20)</p>
                <ListTable maxHeight="30vh">
                  <thead>
                    <tr>
                      <ListTh>Date</ListTh>
                      <ListTh>Delta</ListTh>
                      <ListTh>Reason</ListTh>
                      <ListTh className="hidden sm:table-cell">Tournament</ListTh>
                    </tr>
                  </thead>
                  <tbody>
                    {data.meritHistory.slice(0, 20).map((h, i) => (
                      <ListTr key={i} last={i === Math.min(data.meritHistory.length, 20) - 1}>
                        <ListTd>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {h.createdAt ? new Date(h.createdAt).toLocaleDateString() : '—'}
                          </span>
                        </ListTd>
                        <ListTd>
                          <span
                            className="text-xs font-semibold tabular-nums"
                            style={{ color: h.delta > 0 ? 'var(--color-teal-600)' : 'var(--color-red-600)' }}
                          >
                            {h.delta > 0 ? `+${h.delta}` : h.delta}
                          </span>
                        </ListTd>
                        <ListTd>
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{h.reason ?? '—'}</span>
                        </ListTd>
                        <ListTd className="hidden sm:table-cell">
                          <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                            {h.tournamentId ? h.tournamentId.slice(0, 8) + '…' : '—'}
                          </span>
                        </ListTd>
                      </ListTr>
                    ))}
                  </tbody>
                </ListTable>
              </div>
            )}

            {/* Classification history */}
            {data.classificationHistory && data.classificationHistory.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Classification History (last 20)</p>
                <ListTable maxHeight="25vh">
                  <thead>
                    <tr>
                      <ListTh>Date</ListTh>
                      <ListTh>Change</ListTh>
                      <ListTh>Reason</ListTh>
                    </tr>
                  </thead>
                  <tbody>
                    {data.classificationHistory.slice(0, 20).map((h, i) => (
                      <ListTr key={i} last={i === Math.min(data.classificationHistory.length, 20) - 1}>
                        <ListTd>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {h.createdAt ? new Date(h.createdAt).toLocaleDateString() : '—'}
                          </span>
                        </ListTd>
                        <ListTd>
                          <span className="flex items-center gap-1 flex-wrap">
                            <TierBadge tier={h.fromTier} />
                            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>→</span>
                            <TierBadge tier={h.toTier} />
                          </span>
                        </ListTd>
                        <ListTd>
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{h.reason ?? '—'}</span>
                        </ListTd>
                      </ListTr>
                    ))}
                  </tbody>
                </ListTable>
              </div>
            )}

            {/* Override */}
            <div
              className="rounded-lg border p-3 space-y-2"
              style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}
            >
              <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Override Tier</p>
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <select
                  value={overrideTier}
                  onChange={e => setOverrideTier(e.target.value)}
                  className="px-2 py-1.5 rounded-lg border text-sm"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
                >
                  {TIERS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <button
                  onClick={handleOverride}
                  disabled={overriding}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
                  style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
                >
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

  const LIMIT = 50
  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  const load = useCallback(async (p, tier) => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const d = await tournamentApi.getClassificationPlayers({ page: p, limit: LIMIT, tier: tier || undefined }, token)
      const list = Array.isArray(d) ? d : (d.players ?? d.data ?? [])
      const count = typeof d.total === 'number' ? d.total : list.length
      setPlayers(list)
      setTotal(count)
    } catch (e) {
      setError(e.message || 'Failed to load players.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    load(page, tierFilter)
  }, [page, tierFilter, load])

  function handleTierFilter(t) {
    setTierFilter(t)
    setPage(1)
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Player Classification</p>
        <select
          value={tierFilter}
          onChange={e => handleTierFilter(e.target.value)}
          className="px-2 py-1.5 rounded-lg border text-xs"
          style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        >
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
            {players.map((p, i) => {
              const username = p.username ?? p.user?.username ?? '—'
              const displayName = p.displayName ?? p.user?.displayName ?? '—'
              const isBot = p.isBot ?? p.user?.isBot ?? false
              return (
                <ListTr
                  key={p.userId ?? p.id ?? i}
                  last={i === players.length - 1}
                  onClick={() => setSelectedId(p.userId ?? p.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <ListTd>
                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{username}</span>
                  </ListTd>
                  <ListTd className="hidden sm:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{displayName}</span>
                  </ListTd>
                  <ListTd>
                    <TierBadge tier={p.tier} />
                  </ListTd>
                  <ListTd align="right">
                    <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>{p.merits ?? 0}</span>
                  </ListTd>
                  <ListTd className="hidden md:table-cell">
                    {isBot ? (
                      <span className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}>Bot</span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
                    )}
                  </ListTd>
                </ListTr>
              )
            })}
          </tbody>
        </ListTable>
      )}

      {!loading && players.length === 0 && !error && (
        <p className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>No players found.</p>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Prev
          </button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
            className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Next
          </button>
        </div>
      )}

      {selectedId && (
        <PlayerDetailModal userId={selectedId} token={token} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}

// ── Classification — Merit thresholds panel ───────────────────────────────────

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
      .then(d => {
        const list = Array.isArray(d) ? d : (d.bands ?? d.thresholds ?? [])
        if (list.length > 0) setBands(list)
      })
      .catch(e => setLoadErr(e.message || 'Failed to load thresholds.'))
  }, [token])

  function updateBand(idx, field, value) {
    setBands(prev => prev.map((b, i) => i === idx ? { ...b, [field]: value } : b))
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setSaveErr(null)
    try {
      await tournamentApi.updateMeritThresholds(bands, token)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveErr(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "px-2 py-1.5 rounded-lg border text-sm w-16 text-center"
  const inputStyle = { backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Merit Thresholds</p>
      {loadErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{loadErr}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              {['Band', '1st', '2nd', '3rd', '4th'].map(h => (
                <th key={h} className="text-left pb-2 pr-3 font-semibold" style={{ color: 'var(--text-secondary)' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bands.map((band, idx) => (
              <tr key={idx}>
                <td className="pr-3 py-1.5 whitespace-nowrap font-mono" style={{ color: 'var(--text-muted)' }}>
                  {band.bandMin}–{band.bandMax ?? '+'}
                </td>
                {['pos1', 'pos2', 'pos3', 'pos4'].map(field => (
                  <td key={field} className="pr-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      value={band[field] ?? 0}
                      onChange={e => updateBand(idx, field, Number(e.target.value))}
                      className={inputCls}
                      style={inputStyle}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save Thresholds'}
        </button>
      </div>
      {saveErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveErr}</p>}
    </div>
  )
}

// ── Classification — Config panel ─────────────────────────────────────────────

const CONFIG_FIELDS = [
  { key: 'classification.tiers.RECRUIT.meritsRequired',    label: 'RECRUIT merits required',             type: 'number' },
  { key: 'classification.tiers.CONTENDER.meritsRequired',  label: 'CONTENDER merits required',           type: 'number' },
  { key: 'classification.tiers.VETERAN.meritsRequired',    label: 'VETERAN merits required',             type: 'number' },
  { key: 'classification.tiers.ELITE.meritsRequired',      label: 'ELITE merits required',               type: 'number' },
  { key: 'classification.tiers.CHAMPION.meritsRequired',   label: 'CHAMPION merits required',            type: 'number' },
  { key: 'classification.demotion.finishRatioThreshold',   label: 'Finish ratio threshold',              type: 'float' },
  { key: 'classification.demotion.minQualifyingMatches',   label: 'Min qualifying matches',              type: 'number' },
  { key: 'classification.demotion.reviewCadenceDays',      label: 'Review cadence (days)',               type: 'number' },
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
          CONFIG_FIELDS.forEach(f => {
            flat[f.key] = d[f.key] ?? ''
          })
          setValues(flat)
        }
      })
      .catch(e => setLoadErr(e.message || 'Failed to load config.'))
  }, [token])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setSaveErr(null)
    try {
      const updates = {}
      CONFIG_FIELDS.forEach(f => {
        const raw = values[f.key]
        updates[f.key] = f.type === 'float' ? parseFloat(raw) : Number(raw)
      })
      await tournamentApi.updateClassificationConfig(updates, token)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setSaveErr(e.message || 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Classification Config</p>
      {loadErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{loadErr}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CONFIG_FIELDS.map(f => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{f.label}</label>
            <input
              type="number"
              step={f.type === 'float' ? '0.01' : '1'}
              min={0}
              value={values[f.key] ?? ''}
              onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
              className="px-2 py-1.5 rounded-lg border text-sm"
              style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save Config'}
        </button>
      </div>
      {saveErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{saveErr}</p>}
    </div>
  )
}

// ── Recurring Registrations panel ─────────────────────────────────────────────

function RecurringRegistrations({ token }) {
  const [templateId, setTemplateId] = useState('')
  const [registrations, setRegistrations] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [createTemplateId, setCreateTemplateId] = useState('')
  const [createUserId, setCreateUserId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState(null)
  const [createDone, setCreateDone] = useState(false)

  async function handleLookup() {
    if (!templateId.trim()) return
    setLoading(true)
    setLoadErr(null)
    setRegistrations(null)
    try {
      const d = await tournamentApi.listRecurringRegistrations(templateId.trim(), token)
      const list = Array.isArray(d) ? d : (d.registrations ?? d.data ?? [])
      setRegistrations(list)
    } catch (e) {
      setLoadErr(e.message || 'Failed to load registrations.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate() {
    if (!createTemplateId.trim() || !createUserId.trim()) return
    setCreating(true)
    setCreateErr(null)
    setCreateDone(false)
    try {
      await tournamentApi.recurringRegister(createTemplateId.trim(), token)
      setCreateDone(true)
      setShowCreate(false)
      setCreateTemplateId('')
      setCreateUserId('')
      setTimeout(() => setCreateDone(false), 2000)
    } catch (e) {
      setCreateErr(e.message || 'Enrollment failed.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recurring Registrations</p>
        <button
          onClick={() => { setShowCreate(s => !s); setCreateErr(null) }}
          className="text-xs px-3 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--color-blue-300)', color: 'var(--color-blue-600)' }}
        >
          {showCreate ? 'Cancel' : 'Create Enrollment'}
        </button>
      </div>

      {showCreate && (
        <div className="flex flex-col gap-2 p-3 rounded-lg border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>New Enrollment</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Template ID"
              value={createTemplateId}
              onChange={e => setCreateTemplateId(e.target.value)}
              className="px-2 py-1.5 rounded-lg border text-sm flex-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
            <input
              type="text"
              placeholder="User ID"
              value={createUserId}
              onChange={e => setCreateUserId(e.target.value)}
              className="px-2 py-1.5 rounded-lg border text-sm flex-1"
              style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !createTemplateId.trim() || !createUserId.trim()}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40 whitespace-nowrap"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
            >
              {creating ? 'Enrolling…' : createDone ? 'Done' : 'Enroll'}
            </button>
          </div>
          {createErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{createErr}</p>}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-end">
        <div className="flex flex-col gap-1 flex-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Look up by Template ID</label>
          <input
            type="text"
            placeholder="Recurring tournament template ID…"
            value={templateId}
            onChange={e => setTemplateId(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            className="px-2 py-1.5 rounded-lg border text-sm"
            style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
          />
        </div>
        <button
          onClick={handleLookup}
          disabled={loading || !templateId.trim()}
          className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          {loading ? 'Loading…' : 'Look Up'}
        </button>
      </div>

      {loadErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{loadErr}</p>}

      {registrations !== null && (
        registrations.length === 0 ? (
          <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>No standing registrations for this template.</p>
        ) : (
          <ListTable maxHeight="40vh">
            <thead>
              <tr>
                <ListTh>Template ID</ListTh>
                <ListTh>User ID</ListTh>
                <ListTh align="right">Missed</ListTh>
                <ListTh className="hidden sm:table-cell">Opted Out At</ListTh>
              </tr>
            </thead>
            <tbody>
              {registrations.map((r, i) => (
                <ListTr key={r.id ?? i} last={i === registrations.length - 1}>
                  <ListTd>
                    <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }} title={r.templateId}>
                      {r.templateId ? r.templateId.slice(0, 12) + (r.templateId.length > 12 ? '\u2026' : '') : '—'}
                    </span>
                  </ListTd>
                  <ListTd>
                    <span className="font-mono text-xs" style={{ color: 'var(--text-secondary)' }} title={r.userId}>
                      {r.userId ? r.userId.slice(0, 12) + (r.userId.length > 12 ? '\u2026' : '') : '—'}
                    </span>
                  </ListTd>
                  <ListTd align="right">
                    <span className="text-xs tabular-nums" style={{ color: (r.missedCount ?? 0) > 0 ? 'var(--color-amber-700)' : 'var(--text-muted)' }}>
                      {r.missedCount ?? 0}
                    </span>
                  </ListTd>
                  <ListTd className="hidden sm:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {r.optedOutAt ? new Date(r.optedOutAt).toLocaleDateString() : '—'}
                    </span>
                  </ListTd>
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
  DRAFT:               { bg: 'var(--color-gray-100)',   text: 'var(--text-muted)',          label: 'Draft' },
  REGISTRATION_OPEN:   { bg: 'var(--color-teal-50)',    text: 'var(--color-teal-700)',       label: 'Open' },
  REGISTRATION_CLOSED: { bg: 'var(--color-amber-50)',   text: 'var(--color-amber-700)',      label: 'Reg Closed' },
  IN_PROGRESS:         { bg: 'var(--color-blue-50)',    text: 'var(--color-blue-700)',       label: 'In Progress' },
  COMPLETED:           { bg: 'var(--color-gray-100)',   text: 'var(--text-secondary)',       label: 'Completed' },
  CANCELLED:           { bg: 'var(--color-red-50)',     text: 'var(--color-red-600)',        label: 'Cancelled' },
}

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  )
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

function TournamentModal({ tournament, token, onSaved, onClose }) {
  const isEdit = !!tournament

  async function handleSubmit(data) {
    if (isEdit) {
      await tournamentApi.update(tournament.id, data, token)
    } else {
      await tournamentApi.create(data, token)
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        className="relative w-full max-w-xl mt-8 mb-8 rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            {isEdit ? 'Edit Tournament' : 'Create Tournament'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        <TournamentForm
          initialValues={tournament}
          onSubmit={handleSubmit}
          onCancel={onClose}
          submitLabel={isEdit ? 'Save Changes' : 'Create Tournament'}
        />
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminTournamentsPage() {
  const [tournaments, setTournaments] = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [actionError, setActionError] = useState(null)
  const [token, setToken]     = useState(null)
  const [modal, setModal]     = useState(null) // null | 'create' | { tournament }

  const totalPages = Math.ceil(total / LIMIT)

  // Fetch token once
  useEffect(() => {
    getToken().then(setToken).catch(() => {})
  }, [])

  const load = useCallback(async (p) => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const data = await tournamentApi.list({}, token)
      const list = Array.isArray(data) ? data : (data.tournaments ?? [])
      // Client-side pagination since the API may not support it
      setTotal(list.length)
      const start = (p - 1) * LIMIT
      setTournaments(list.slice(start, start + LIMIT))
    } catch {
      setError('Failed to load tournaments.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) load(page)
  }, [token, page, load])

  async function performAction(action, tournament, label) {
    if (!confirm(`${label} "${tournament.name}"?`)) return
    setActionError(null)
    try {
      await tournamentApi[action](tournament.id, token)
      load(page)
    } catch (e) {
      setActionError(e.message || `${label} failed.`)
    }
  }

  function handleSaved() {
    setModal(null)
    load(page)
  }

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <AdminHeader
        title="Tournaments"
        subtitle={`${total} total`}
      />

      {/* Create button */}
      <div className="flex justify-end">
        <button
          onClick={() => setModal('create')}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
        >
          + Create Tournament
        </button>
      </div>

      {actionError && <ErrorMsg>{actionError}</ErrorMsg>}
      {loading && <Spinner />}
      {error && <ErrorMsg>{error}</ErrorMsg>}

      {!loading && (
        <ListTable maxHeight="65vh">
          <thead>
            <tr>
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
                  {/* Name */}
                  <ListTd>
                    <Link
                      to={`/tournaments/${t.id}`}
                      className="font-medium text-sm hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {t.name}
                    </Link>
                    {t.description && (
                      <p className="text-[10px] truncate max-w-[180px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {t.description}
                      </p>
                    )}
                  </ListTd>

                  {/* Status */}
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

                  {/* Format */}
                  <ListTd className="hidden md:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {t.bracketType?.replace('_', ' ')}
                    </span>
                  </ListTd>

                  {/* Mode */}
                  <ListTd className="hidden md:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.mode}</span>
                  </ListTd>

                  {/* Players */}
                  <ListTd align="right" className="hidden lg:table-cell">
                    <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>
                      {participantCount}
                      {t.maxParticipants ? `/${t.maxParticipants}` : ''}
                    </span>
                  </ListTd>

                  {/* Start */}
                  <ListTd className="hidden lg:table-cell">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.startTime ? new Date(t.startTime).toLocaleString() : '—'}
                    </span>
                  </ListTd>

                  {/* Actions */}
                  <ListTd align="right">
                    <div className="flex items-center gap-1 justify-end flex-wrap">
                      <Link
                        to={`/tournaments/${t.id}`}
                        className="text-xs px-2 py-1 rounded border no-underline transition-colors hover:bg-[var(--bg-surface-hover)]"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                      >
                        View
                      </Link>
                      {canEdit && (
                        <button
                          onClick={() => setModal({ tournament: t })}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--bg-surface-hover)]"
                          style={{ borderColor: 'var(--color-blue-300)', color: 'var(--color-blue-600)' }}
                        >
                          Edit
                        </button>
                      )}
                      {canPublish && (
                        <button
                          onClick={() => performAction('publish', t, 'Publish')}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-teal-50)]"
                          style={{ borderColor: 'var(--color-teal-300)', color: 'var(--color-teal-600)' }}
                        >
                          Publish
                        </button>
                      )}
                      {canStart && (
                        <button
                          onClick={() => performAction('start', t, 'Start')}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-blue-50)]"
                          style={{ borderColor: 'var(--color-blue-300)', color: 'var(--color-blue-600)' }}
                        >
                          Start
                        </button>
                      )}
                      {canCancel && (
                        <button
                          onClick={() => performAction('cancel', t, 'Cancel')}
                          className="text-xs px-2 py-1 rounded border transition-colors hover:bg-[var(--color-red-50)] hover:text-[var(--color-red-600)]"
                          style={{ borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </ListTd>
                </ListTr>
              )
            })}
          </tbody>
        </ListTable>
      )}

      {!loading && tournaments.length === 0 && !error && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>
          No tournaments found. Create one above.
        </p>
      )}

      <ListPagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={LIMIT}
        onPageChange={setPage}
        noun="tournaments"
      />

      <BotMatchConfig token={token} />
      <BotMatchMonitor token={token} />

      {/* ── Classification ── */}
      <div
        className="rounded-xl border p-4 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <p className="text-sm font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Classification
        </p>
        <ClassificationPanel token={token} />
        <MeritThresholdsPanel token={token} />
        <ClassificationConfigPanel token={token} />
        <RecurringRegistrations token={token} />
      </div>

      {/* Create / Edit modal */}
      {modal && (
        <TournamentModal
          tournament={modal === 'create' ? null : modal.tournament}
          token={token}
          onSaved={handleSaved}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
