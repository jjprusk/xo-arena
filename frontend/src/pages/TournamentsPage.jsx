import React, { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { tournamentApi } from '../lib/tournamentApi.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useTournamentSocket } from '../hooks/useTournamentSocket.js'
import { useSpotlight, SpotlightRing } from '../lib/useSpotlight.jsx'

// ── Status badge ─────────────────────────────────────────────────────────────

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
            backgroundColor: value === opt.value ? 'var(--color-blue-600)' : 'var(--bg-surface)',
            color:           value === opt.value ? 'white'                  : 'var(--text-secondary)',
            borderColor:     value === opt.value ? 'var(--color-blue-600)' : 'var(--border-default)',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Registration button ───────────────────────────────────────────────────────

function RegisterButton({ tournament, token, onSuccess }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)

  async function handle(e) {
    e.preventDefault()
    e.stopPropagation()
    setBusy(true)
    setErr(null)
    try {
      await tournamentApi.register(tournament.id, token)
      onSuccess()
    } catch (error) {
      setErr(error.message || 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        onClick={handle}
        disabled={busy}
        className="btn btn-teal btn-sm"
      >
        {busy ? 'Joining…' : 'Register'}
      </button>
      {err && <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
    </div>
  )
}

// ── Tournament card ───────────────────────────────────────────────────────────

function TournamentCard({ tournament, token, onRegistered, spotlitRegister = false }) {
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
        {/* Header row */}
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

        {/* Description */}
        {tournament.description && (
          <p className="text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
            {tournament.description}
          </p>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>
            {participantCount}{max ? `/${max}` : ''} players
          </span>
          {tournament.bestOfN && (
            <span>Best of {tournament.bestOfN}</span>
          )}
          {tournament.startTime && (
            <span>
              Starts {new Date(tournament.startTime).toLocaleString()}
            </span>
          )}
        </div>

        {/* Registration window */}
        {tournament.registrationOpenAt && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Reg: {new Date(tournament.registrationOpenAt).toLocaleString()}
            {tournament.registrationCloseAt && (
              <> – {new Date(tournament.registrationCloseAt).toLocaleString()}</>
            )}
          </p>
        )}

        {/* Register button */}
        {isOpen && token && (
          <div onClick={e => e.preventDefault()}>
            {spotlitRegister ? (
              <SpotlightRing label="Step 6: Enter a tournament →">
                <RegisterButton tournament={tournament} token={token} onSuccess={onRegistered} />
              </SpotlightRing>
            ) : (
              <RegisterButton tournament={tournament} token={token} onSuccess={onRegistered} />
            )}
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

  // Journey step 6 spotlight on the first open tournament's Register button
  const { active: spotlightStep6 } = useSpotlight(6)

  // Subscribe to live tournament events so we can refresh on changes
  const { lastEvent } = useTournamentSocket()

  // Fetch token once
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
      // Exclude DRAFT from the public list by either filtering server-side or client-side
      const params = {}
      if (filter) params.status = filter
      const data = await tournamentApi.list(params, token)
      const list = Array.isArray(data) ? data : (data.tournaments ?? [])
      // Hide DRAFT tournaments on public page
      setTournaments(list.filter(t => t.status !== 'DRAFT'))
    } catch {
      setError('Failed to load tournaments.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load(statusFilter) }, [statusFilter, load])

  // ?action=register&tournamentId=X — auto-register once data is ready
  useEffect(() => {
    if (!autoRegisterId || !token || loading || tournaments.length === 0) return
    const target = tournaments.find(t => t.id === autoRegisterId && t.status === 'REGISTRATION_OPEN')
    if (!target) return
    tournamentApi.register(autoRegisterId, token)
      .then(() => { setAutoRegisterId(null); load(statusFilter) })
      .catch(() => setAutoRegisterId(null))
  }, [autoRegisterId, token, loading, tournaments]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when a tournament event arrives
  useEffect(() => {
    if (lastEvent) load(statusFilter)
  }, [lastEvent]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilterChange(val) {
    setStatusFilter(val)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Page header */}
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1
          className="text-3xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
        >
          Tournaments
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Compete in structured brackets and climb the ranks.
        </p>
      </div>

      {/* Filter bar */}
      <FilterBar value={statusFilter} onChange={handleFilterChange} />

      {/* Error */}
      {error && (
        <p className="text-sm text-center py-4" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      )}

      {/* Loading skeletons */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <CardSkeleton key={i} />)}
        </div>
      )}

      {/* Tournament grid */}
      {!loading && tournaments.length > 0 && (() => {
        const firstOpenIdx = tournaments.findIndex(t => t.status === 'REGISTRATION_OPEN')
        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {tournaments.map((t, idx) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                token={token}
                onRegistered={() => load(statusFilter)}
                spotlitRegister={spotlightStep6 && idx === firstOpenIdx}
              />
            ))}
          </div>
        )
      })()}

      {/* Empty state */}
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
