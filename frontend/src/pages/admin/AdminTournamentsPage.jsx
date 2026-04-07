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
                    <StatusBadge status={t.status} />
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
