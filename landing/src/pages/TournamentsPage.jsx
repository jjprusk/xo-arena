import React, { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { tournamentApi } from '../lib/tournamentApi.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useTournamentSocket } from '../hooks/useTournamentSocket.js'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META = {
  DRAFT:               { cls: 'badge-draft',     label: 'Draft' },
  REGISTRATION_OPEN:   { cls: 'badge-open',      label: 'Open' },
  REGISTRATION_CLOSED: { cls: 'badge-closed',    label: 'Reg Closed' },
  IN_PROGRESS:         { cls: 'badge-live',      label: 'In Progress' },
  COMPLETED:           { cls: 'badge-done',      label: 'Completed' },
  CANCELLED:           { cls: 'badge-cancelled', label: 'Cancelled' },
}

function StatusBadge({ status }) {
  const { cls, label } = STATUS_META[status] ?? STATUS_META.DRAFT
  return <span className={`badge ${cls}`}>{label}</span>
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
  { label: 'All',         value: '' },
  { label: 'Open',        value: 'REGISTRATION_OPEN' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Completed',   value: 'COMPLETED' },
]

function FilterBar({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {FILTER_OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
          style={{
            backgroundColor: value === opt.value ? 'var(--color-primary)' : 'var(--bg-surface)',
            color:           value === opt.value ? 'white'                 : 'var(--text-secondary)',
            borderColor:     value === opt.value ? 'var(--color-primary)' : 'var(--border-default)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Registration button ───────────────────────────────────────────────────────

const NOTIF_PREF_OPTIONS = [
  { value: 'AS_PLAYED',         label: 'After each match' },
  { value: 'END_OF_TOURNAMENT', label: 'When tournament ends' },
]

function RegisterButton({ tournament, token, onSuccess }) {
  const [step, setStep] = useState('idle')
  const [notifPref, setNotifPref] = useState('AS_PLAYED')
  const [err, setErr] = useState(null)

  async function handleConfirm(e) {
    e.preventDefault()
    e.stopPropagation()
    setStep('busy')
    setErr(null)
    try {
      await tournamentApi.register(tournament.id, token, { resultNotifPref: notifPref })
      onSuccess()
    } catch (error) {
      setErr(error.message || 'Failed')
      setStep('picking')
    }
  }

  if (step === 'idle') {
    return (
      <div>
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); setStep('picking') }}
          className="btn-primary text-xs px-4 py-2 rounded-lg font-semibold text-white transition-all hover:brightness-110"
        >
          Register
        </button>
      </div>
    )
  }

  return (
    <div
      className="space-y-2 p-2 rounded-lg border"
      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)' }}
      onClick={e => e.preventDefault()}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        Notify me:
      </p>
      <div className="flex flex-col gap-1">
        {NOTIF_PREF_OPTIONS.map(opt => (
          <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name={`notif-${tournament.id}`}
              value={opt.value}
              checked={notifPref === opt.value}
              onChange={() => setNotifPref(opt.value)}
              className="accent-[var(--color-primary)]"
            />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{opt.label}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={handleConfirm}
          disabled={step === 'busy'}
          className="btn-primary text-xs px-3 py-1.5 rounded-lg font-semibold text-white flex-1 disabled:opacity-50"
        >
          {step === 'busy' ? 'Joining…' : 'Confirm'}
        </button>
        <button
          onClick={e => { e.preventDefault(); setStep('idle'); setErr(null) }}
          disabled={step === 'busy'}
          className="text-xs px-3 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
          style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
      </div>
      {err && <p className="text-[10px]" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
    </div>
  )
}

// ── Tournament card ───────────────────────────────────────────────────────────

function TournamentCard({ tournament, token, onRegistered }) {
  const participantCount = tournament.participants?.length ?? tournament._count?.participants ?? 0
  const max  = tournament.maxParticipants
  const isOpen = tournament.status === 'REGISTRATION_OPEN'

  return (
    <Link
      to={`/tournaments/${tournament.id}`}
      className="block rounded-xl border transition-colors hover:bg-[var(--bg-surface-hover)] no-underline"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2
              className="text-sm font-bold leading-tight truncate"
              style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
            >
              {tournament.name}
            </h2>
            <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
              {tournament.game?.toUpperCase()} · {tournament.mode} · {tournament.bracketType?.replace('_', ' ')}
            </p>
          </div>
          <StatusBadge status={tournament.status} />
        </div>

        {tournament.description && (
          <p className="text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
            {tournament.description}
          </p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>{participantCount}{max ? `/${max}` : ''} players</span>
          {tournament.bestOfN && <span>Best of {tournament.bestOfN}</span>}
          {tournament.startTime && (
            <span>Starts {new Date(tournament.startTime).toLocaleString()}</span>
          )}
        </div>

        {tournament.registrationOpenAt && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Reg: {new Date(tournament.registrationOpenAt).toLocaleString()}
            {tournament.registrationCloseAt && (
              <> – {new Date(tournament.registrationCloseAt).toLocaleString()}</>
            )}
          </p>
        )}

        {isOpen && token && (
          <div onClick={e => e.preventDefault()}>
            <RegisterButton tournament={tournament} token={token} onSuccess={onRegistered} />
          </div>
        )}
      </div>
    </Link>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div
      className="rounded-xl border p-4 space-y-3 animate-pulse"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
    >
      <div className="h-4 rounded w-2/3" style={{ backgroundColor: 'var(--border-default)' }} />
      <div className="h-3 rounded w-1/2" style={{ backgroundColor: 'var(--border-default)' }} />
      <div className="h-3 rounded w-3/4" style={{ backgroundColor: 'var(--border-default)' }} />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TournamentsPage() {
  const { data: session } = useOptimisticSession()
  const [searchParams] = useSearchParams()
  const [tournaments, setTournaments] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [token, setToken]             = useState(null)
  const [autoRegisterId, setAutoRegisterId] = useState(
    searchParams.get('action') === 'register' ? searchParams.get('tournamentId') : null
  )

  const { lastEvent } = useTournamentSocket()

  useEffect(() => {
    if (session?.user?.id) {
      getToken().then(setToken).catch(() => {})
    } else {
      setToken(null)
    }
  }, [session?.user?.id])

  const load = useCallback(async (filter) => {
    setLoading(true)
    setError(null)
    try {
      const params = {}
      if (filter) params.status = filter
      const data = await tournamentApi.list(params, token)
      const list = Array.isArray(data) ? data : (data.tournaments ?? [])
      setTournaments(list.filter(t => t.status !== 'DRAFT'))
    } catch {
      setError('Failed to load tournaments.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load(statusFilter) }, [statusFilter, load])

  useEffect(() => {
    if (!autoRegisterId || !token || loading || tournaments.length === 0) return
    const target = tournaments.find(t => t.id === autoRegisterId && t.status === 'REGISTRATION_OPEN')
    if (!target) return
    tournamentApi.register(autoRegisterId, token)
      .then(() => { setAutoRegisterId(null); load(statusFilter) })
      .catch(() => setAutoRegisterId(null))
  }, [autoRegisterId, token, loading, tournaments]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (lastEvent) load(statusFilter)
  }, [lastEvent]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-5">
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Tournaments
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Compete in structured brackets and climb the ranks.
        </p>
      </div>

      <FilterBar value={statusFilter} onChange={setStatusFilter} />

      {error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      )}

      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
        </div>
      )}

      {!loading && tournaments.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tournaments.map(t => (
            <TournamentCard
              key={t.id}
              tournament={t}
              token={token}
              onRegistered={() => load(statusFilter)}
            />
          ))}
        </div>
      )}

      {!loading && tournaments.length === 0 && !error && (
        <div className="text-center py-16 space-y-2">
          <p className="text-3xl">⊕</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No tournaments found</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {statusFilter ? 'Try a different filter.' : 'Check back soon for upcoming events.'}
          </p>
        </div>
      )}
    </div>
  )
}
