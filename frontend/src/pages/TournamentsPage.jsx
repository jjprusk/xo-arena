import React, { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { tournamentApi } from '../lib/tournamentApi.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useTournamentSocket } from '../hooks/useTournamentSocket.js'
import { useSpotlight, SpotlightRing } from '../lib/useSpotlight.jsx'
import api from '../lib/api.js'

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

const NOTIF_PREF_OPTIONS = [
  { value: 'AS_PLAYED',         label: 'After each match' },
  { value: 'END_OF_TOURNAMENT', label: 'When tournament ends' },
]

function RegisterButton({ tournament, token, onSuccess }) {
  const [step, setStep] = useState('idle')   // 'idle' | 'picking' | 'busy'
  const [notifPref, setNotifPref] = useState('AS_PLAYED')
  const [myBots, setMyBots] = useState([])
  const [selectedBotId, setSelectedBotId] = useState(null)
  const [err, setErr] = useState(null)

  const isBotTournament = tournament.mode === 'BOT_VS_BOT'

  async function handleOpen(e) {
    e.preventDefault()
    e.stopPropagation()
    setStep('picking')
    if (isBotTournament) {
      try {
        const { bots } = await api.bots.mine(token)
        const active = (bots ?? []).filter(b => b.botActive !== false)
        setMyBots(active)
        // Only set default if nothing already selected (don't overwrite user's choice)
        setSelectedBotId(prev => prev ?? (active.length > 0 ? active[0].id : null))
      } catch {
        setMyBots([])
      }
    }
  }

  async function handleConfirm(e) {
    e.preventDefault()
    e.stopPropagation()
    if (isBotTournament && !selectedBotId) {
      setErr('Select a bot to register')
      return
    }
    setStep('busy')
    setErr(null)
    try {
      const body = { resultNotifPref: notifPref }
      if (isBotTournament && selectedBotId) body.participantUserId = selectedBotId
      await tournamentApi.register(tournament.id, token, body)
      onSuccess()
    } catch (error) {
      setErr(error.message || 'Failed')
      setStep('picking')
    }
  }

  if (step === 'idle') {
    return (
      <div>
        <button onClick={handleOpen} className="btn btn-teal btn-sm">
          Register
        </button>
      </div>
    )
  }

  return (
    <div
      className="space-y-2 p-2 rounded-lg border"
      style={{ backgroundColor: 'var(--bg-base)', borderColor: 'var(--border-default)' }}
    >
      {isBotTournament && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Register as:
          </p>
          {myBots.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No active bots found. Create a bot first.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {myBots.map(bot => (
                <label key={bot.id} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name={`bot-${tournament.id}`}
                    value={bot.id}
                    checked={selectedBotId === bot.id}
                    onChange={() => setSelectedBotId(bot.id)}
                    className="accent-[var(--color-teal-500)]"
                  />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{bot.displayName}</span>
                </label>
              ))}
            </div>
          )}
        </>
      )}
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
              className="accent-[var(--color-teal-500)]"
            />
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{opt.label}</span>
          </label>
        ))}
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={handleConfirm}
          disabled={step === 'busy' || (isBotTournament && myBots.length === 0)}
          className="btn btn-teal btn-sm flex-1"
        >
          {step === 'busy' ? 'Joining…' : 'Confirm'}
        </button>
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); setStep('idle'); setErr(null) }}
          disabled={step === 'busy'}
          className="btn btn-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          Cancel
        </button>
      </div>
      {err && <p className="text-[10px]" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
    </div>
  )
}

// ── Tournament card ───────────────────────────────────────────────────────────

function TournamentCard({ tournament, token, onRegistered, spotlitRegister = false }) {
  const participantCount = tournament.participants?.length ?? tournament._count?.participants ?? 0
  const max  = tournament.maxParticipants
  const isOpen = tournament.status === 'REGISTRATION_OPEN'

  return (
    <div
      className="rounded-xl border"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      {/* Clickable card body — navigates to detail page */}
      <Link
        to={`/tournaments/${tournament.id}`}
        className="block p-4 space-y-3 transition-colors hover:bg-[var(--bg-surface-hover)] no-underline rounded-t-xl"
        style={{ borderRadius: isOpen && token ? '0.75rem 0.75rem 0 0' : '0.75rem' }}
      >
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
      </Link>

      {/* Register form — outside the Link so radio/button clicks never trigger navigation */}
      {isOpen && token && (
        <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: 'var(--border-default)' }}>
          <SpotlightRing active={spotlitRegister} label="Step 6: Enter a tournament →">
            <RegisterButton tournament={tournament} token={token} onSuccess={onRegistered} />
          </SpotlightRing>
        </div>
      )}
    </div>
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

  // silent=true refreshes data in background without showing skeleton or unmounting cards
  const load = useCallback(async (filter, silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const params = {}
      if (filter) params.status = filter
      const data = await tournamentApi.list(params, token)
      const list = Array.isArray(data) ? data : (data.tournaments ?? [])
      setTournaments(list.filter(t => t.status !== 'DRAFT'))
    } catch {
      if (!silent) setError('Failed to load tournaments.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [token])

  useEffect(() => { load(statusFilter) }, [statusFilter, load])

  // ?action=register&tournamentId=X — auto-register once data is ready
  useEffect(() => {
    if (!autoRegisterId || !token || loading || tournaments.length === 0) return
    const target = tournaments.find(t => t.id === autoRegisterId && t.status === 'REGISTRATION_OPEN')
    if (!target) return
    tournamentApi.register(autoRegisterId, token)
      .then(() => { setAutoRegisterId(null); load(statusFilter, true) })
      .catch(() => setAutoRegisterId(null))
  }, [autoRegisterId, token, loading, tournaments]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh silently on socket events — silent=true keeps cards mounted so registration state is preserved
  useEffect(() => {
    if (lastEvent) load(statusFilter, true)
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
