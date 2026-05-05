// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback, useMemo } from 'react'

// ── Viewport ──────────────────────────────────────────────────────────────────
// Sub-640px phones drop the "Starts" column and use a compact Register
// button so the tournament card fits without horizontal scroll. Handled
// via matchMedia so the layout reflows on orientation change without a
// route reload.
function useIsMobile(query = '(max-width: 639px)') {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(query)
    const handler = e => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [query])
  return mobile
}
import { createPortal } from 'react-dom'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { tournamentApi } from '../lib/tournamentApi.js'
import { api } from '../lib/api.js'
import { useSWRish } from '../lib/swr.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useEventStream } from '../lib/useEventStream.js'
import { useGuideStore } from '../store/guideStore.js'
import { ListTable, ListTh, ListTr, ListTd, ListPagination, SearchBar } from '../components/ui/ListTable.jsx'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

async function fetchMyBots(token, dbUserId) {
  const res = await fetch(`${API_BASE}/api/v1/bots?ownerId=${dbUserId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.bots ?? []).filter(b => b.botActive)
}

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

// ── Date filter ───────────────────────────────────────────────────────────────
// Values are keys used by tournamentMatchesSince() — 'all' means no filter.

const DATE_OPTIONS = [
  { label: 'Today',      value: 'today'     },
  { label: 'Yesterday',  value: 'yesterday' },
  { label: 'Past week',  value: 'week'      },
  { label: 'Past month', value: 'month'     },
  { label: 'This year',  value: 'year'      },
  { label: 'All',        value: 'all'       },
]

/** Resolve a date-range key into `{ since, until }` (both ISO strings | null). */
function resolveDateRange(key) {
  const now = new Date()
  if (key === 'today') {
    const since = new Date(now); since.setHours(0, 0, 0, 0)
    return { since: since.toISOString(), until: null }
  }
  if (key === 'yesterday') {
    const since = new Date(now); since.setDate(since.getDate() - 1); since.setHours(0, 0, 0, 0)
    const until = new Date(since); until.setDate(until.getDate() + 1)
    return { since: since.toISOString(), until: until.toISOString() }
  }
  if (key === 'week') {
    const since = new Date(now); since.setDate(since.getDate() - 7)
    return { since: since.toISOString(), until: null }
  }
  if (key === 'month') {
    const since = new Date(now); since.setDate(since.getDate() - 30)
    return { since: since.toISOString(), until: null }
  }
  if (key === 'year') {
    const since = new Date(now.getFullYear(), 0, 1)
    return { since: since.toISOString(), until: null }
  }
  return { since: null, until: null }  // 'all'
}

/**
 * Pill-shaped select so the date picker sits on the same row as the status
 * pills and the search box instead of wrapping. The chevron mirrors what
 * TablesPage uses for its date dropdown for cross-page consistency.
 */
function DateFilter({ value, onChange }) {
  return (
    <div className="relative inline-flex">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label="Date range"
        className="appearance-none pl-3.5 pr-8 py-1.5 rounded-full border text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] transition-colors"
        style={{
          background:  'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          color:       'var(--text-primary)',
        }}
      >
        {DATE_OPTIONS.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
        width="10" height="10" viewBox="0 0 10 10" fill="none"
        style={{ color: 'var(--text-muted)' }}
      >
        <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// ── Registration button ───────────────────────────────────────────────────────

const NOTIF_PREF_OPTIONS = [
  { value: 'AS_PLAYED',         label: 'After each match' },
  { value: 'END_OF_TOURNAMENT', label: 'When tournament ends' },
]

/**
 * Inline "Register" button that opens a modal for the picker flow. The
 * previous design crammed the radio-group picker into the narrow action cell
 * of the ListTable row, which became unusable on narrow windows (content
 * overflowed and the Confirm button was clipped). A modal gets its own
 * space regardless of viewport width and matches the pattern used elsewhere
 * (admin Create Tournament, sign-in).
 */
function RegisterButton({ tournament, token, dbUserId, onSuccess, compact = false }) {
  const [open, setOpen] = useState(false)
  async function openModal(e) {
    e.preventDefault(); e.stopPropagation()
    setOpen(true)
  }
  return (
    <>
      <button
        onClick={openModal}
        className={`btn-primary rounded-lg font-semibold text-white transition-all hover:brightness-110 ${compact ? 'text-[11px] px-2 py-1' : 'text-xs px-4 py-2'}`}
      >
        Register
      </button>
      {open && (
        <RegisterModal
          tournament={tournament}
          token={token}
          dbUserId={dbUserId}
          onClose={() => setOpen(false)}
          onSuccess={() => { setOpen(false); onSuccess() }}
        />
      )}
    </>
  )
}

function RegisterModal({ tournament, token, dbUserId, onClose, onSuccess }) {
  const needsBotPicker = tournament.mode === 'BOT_VS_BOT' || tournament.mode === 'MIXED'
  const [bots, setBots]                   = useState([])
  const [loadingBots, setLoadingBots]     = useState(needsBotPicker)
  const [participantId, setParticipantId] = useState('self')
  const [notifPref, setNotifPref]         = useState('AS_PLAYED')
  const [busy, setBusy]                   = useState(false)
  const [err, setErr]                     = useState(null)

  useEffect(() => {
    if (!needsBotPicker) return
    fetchMyBots(token, dbUserId)
      .then(fetched => {
        setBots(fetched)
        if (fetched.length > 0 && tournament.mode === 'BOT_VS_BOT') {
          setParticipantId(fetched[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingBots(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape closes.
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function handleConfirm() {
    setBusy(true); setErr(null)
    try {
      const body = { resultNotifPref: notifPref }
      if (participantId !== 'self') body.participantUserId = participantId
      await tournamentApi.register(tournament.id, token, body)
      onSuccess()
    } catch (error) {
      setErr(error.message || 'Failed')
      setBusy(false)
    }
  }

  const confirmDisabled = busy
    || (tournament.mode === 'BOT_VS_BOT' && participantId === 'self' && bots.length > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={() => { if (!busy) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Register for ${tournament.name}`}
        className="w-full max-w-md rounded-xl border p-5 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-bold leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            Register for {tournament.name}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {tournament.game?.toUpperCase()} · {tournament.mode} · Best of {tournament.bestOfN}
          </p>
        </div>

        {needsBotPicker && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Register as
            </p>
            {loadingBots ? (
              <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>Loading your bots…</p>
            ) : (
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto rounded-lg border p-2"
                   style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                {tournament.mode === 'MIXED' && (
                  <label className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input type="radio" name={`who-${tournament.id}`} value="self"
                      checked={participantId === 'self'} onChange={() => setParticipantId('self')}
                      className="accent-[var(--color-primary)]" />
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>Myself (human)</span>
                  </label>
                )}
                {bots.length === 0 && (
                  <p className="text-sm italic py-1" style={{ color: 'var(--text-muted)' }}>
                    {tournament.mode === 'BOT_VS_BOT' ? 'You have no active bots.' : 'No active bots.'}
                  </p>
                )}
                {bots.map(bot => (
                  <label key={bot.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input type="radio" name={`who-${tournament.id}`} value={bot.id}
                      checked={participantId === bot.id} onChange={() => setParticipantId(bot.id)}
                      className="accent-[var(--color-primary)]" />
                    <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{bot.displayName}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Notify me
          </p>
          <div className="flex flex-col gap-1 rounded-lg border p-2"
               style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
            {NOTIF_PREF_OPTIONS.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer py-0.5">
                <input type="radio" name={`notif-${tournament.id}`} value={opt.value}
                  checked={notifPref === opt.value} onChange={() => setNotifPref(opt.value)}
                  className="accent-[var(--color-primary)]" />
                <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {err && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className="btn-primary text-sm px-4 py-2 rounded-lg font-semibold text-white flex-1 disabled:opacity-50"
          >
            {busy ? 'Registering…' : 'Confirm'}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Journey step 7 tutorial ──────────────────────────────────────────────────
//
// First-visit modal that explains how tournaments work. On dismiss, marks
// journey step 7 complete — the terminal step, which also fires +50 TC via
// journeyService.completeStep. Shown at most once per user (server-side state).
function JourneyTutorialModal({ onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Render into body so we escape any parent stacking context (the Guide
  // panel sits at z-50 on another branch of the tree and can otherwise
  // overlap this modal's backdrop/click targets).
  return createPortal((
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 60 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How tournaments work"
        className="w-full max-w-md rounded-xl border p-5 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
        onClick={e => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-bold leading-tight" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
            How to enter a tournament
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            You're looking at the Arena's tournament hub. Here's the short version:
          </p>
        </div>
        <ol className="text-sm space-y-2 pl-5 list-decimal" style={{ color: 'var(--text-secondary)' }}>
          <li>Browse the list below — statuses tell you which tournaments are open for registration.</li>
          <li>Click a <strong style={{ color: 'var(--text-primary)' }}>Registration open</strong> tournament to see the format, prize (if any), and field.</li>
          <li>Hit <strong style={{ color: 'var(--text-primary)' }}>Register</strong>. You can enter yourself (human) or one of your bots.</li>
          <li>When the bracket starts, you'll get a notification. Matches begin automatically.</li>
        </ol>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No rush — closing this counts as your final onboarding step. You'll earn +50 Tournament Credits.
        </p>
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold"
            style={{ backgroundColor: 'var(--color-amber-500)', color: 'white' }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  ), document.body)
}

// ── Tournament card ───────────────────────────────────────────────────────────

function TournamentRow({ tournament, token, dbUserId, onRegistered, last, isMobile = false }) {
  const navigate = useNavigate()
  const participantCount = tournament.participants?.length ?? tournament._count?.participants ?? 0
  const max = tournament.maxParticipants
  // Registration is actually open only when registrationOpenAt is in the
  // past (or unset). Backend gates the POST /register endpoint on this,
  // but the UI was previously showing the Register button anyway —
  // misleading for templates whose first occurrence spawns with
  // status=REGISTRATION_OPEN but registrationOpenAt set to a future time.
  const now = Date.now()
  const regOpened = !tournament.registrationOpenAt || new Date(tournament.registrationOpenAt).getTime() <= now
  const regStillOpen = !tournament.registrationCloseAt || new Date(tournament.registrationCloseAt).getTime() > now
  const isOpen = tournament.status === 'REGISTRATION_OPEN' && regOpened && regStillOpen
  const isUpcoming = tournament.status === 'REGISTRATION_OPEN' && !regOpened

  const meta = [
    tournament.game?.toUpperCase(),
    tournament.mode,
    tournament.bracketType?.replace('_', ' '),
    tournament.bestOfN ? `Best of ${tournament.bestOfN}` : null,
  ].filter(Boolean).join(' · ')

  const startText = tournament.startTime
    ? new Date(tournament.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : '—'

  return (
    <ListTr last={last} onClick={() => navigate(`/tournaments/${tournament.id}`)}>
      <ListTd>
        <div className="min-w-0">
          <div
            className="text-sm font-bold leading-tight truncate flex items-center gap-1.5"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {tournament.templateId && (
              <svg
                className="shrink-0"
                width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2.25"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ color: 'var(--color-blue-600)' }}
                role="img"
                aria-label="Recurring tournament"
              >
                <title>Recurring tournament — runs on a repeating schedule</title>
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            )}
            {tournament.name}
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
            {meta}
          </div>
          {tournament.description && (
            <div className="text-xs mt-1 line-clamp-1" style={{ color: 'var(--text-secondary)' }}>
              {tournament.description}
            </div>
          )}
        </div>
      </ListTd>
      {!isMobile && (
        <ListTd>
          <div className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
            {startText}
          </div>
        </ListTd>
      )}
      <ListTd align="center">
        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
          {participantCount}{max ? `/${max}` : ''}
        </span>
      </ListTd>
      <ListTd align="center">
        {/* "Upcoming" is rendered in place of "Open" when the tournament
            is REGISTRATION_OPEN server-side but registrationOpenAt is in
            the future. Prevents the row from implying you can register
            now. */}
        {isUpcoming
          ? <span className="badge badge-draft" title={`Registration opens ${new Date(tournament.registrationOpenAt).toLocaleString()}`}>Upcoming</span>
          : <StatusBadge status={tournament.status} />}
      </ListTd>
      <ListTd align="right">
        {tournament.status === 'IN_PROGRESS' ? (
          <Link
            to={`/tournaments/${tournament.id}?watch=1`}
            onClick={e => e.stopPropagation()}
            className={`inline-flex items-center gap-1 rounded-lg font-semibold whitespace-nowrap border transition-colors hover:bg-[var(--color-primary-50)] ${isMobile ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-1.5'}`}
            style={{ color: 'var(--color-primary)', borderColor: 'var(--border-default)' }}
            title="Watch a live match"
          >
            👁 {isMobile ? '' : 'Watch'}
          </Link>
        ) : isUpcoming ? (
          <span
            className={`inline-block rounded-lg font-medium whitespace-nowrap ${isMobile ? 'text-[10px] px-2 py-1' : 'text-xs px-3 py-1.5'}`}
            style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
            title={`Registration opens ${new Date(tournament.registrationOpenAt).toLocaleString()}`}
          >
            {isMobile
              ? `Opens ${new Date(tournament.registrationOpenAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })}`
              : `Opens ${new Date(tournament.registrationOpenAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
          </span>
        ) : isOpen && token ? (
          <div onClick={e => e.stopPropagation()}>
            {tournament.isRegisteredByViewer ? (
              <span
                className={`inline-block rounded-lg font-semibold whitespace-nowrap ${isMobile ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-1.5'}`}
                style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-muted)', border: '1px solid var(--border-default)' }}
              >
                {isMobile ? '✓' : '✓ Registered'}
              </span>
            ) : (
              <RegisterButton tournament={tournament} token={token} dbUserId={dbUserId} onSuccess={onRegistered} compact={isMobile} />
            )}
          </div>
        ) : null}
      </ListTd>
    </ListTr>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSpinner() {
  // Simple centered spinner. Replaces the prior grid-of-card skeletons which
  // looked like a matrix of shadows flashing on every filter change. For a
  // list with a sub-second fetch, a single spinner is quieter and cheaper.
  return (
    <div className="flex items-center justify-center py-12" aria-busy="true" aria-label="Loading tournaments">
      <div
        className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TournamentsPage() {
  const { data: session } = useOptimisticSession()
  const isMobile = useIsMobile()
  const [searchParams, setSearchParams] = useSearchParams()
  const [token, setToken]             = useState(null)
  const [dbUserId, setDbUserId]       = useState(null)
  const [showTutorial, setShowTutorial] = useState(false)
  const [autoRegisterId, setAutoRegisterId] = useState(
    searchParams.get('action') === 'register' ? searchParams.get('tournamentId') : null
  )

  // Journey step 7 — "Learn about tournaments" — is a client-side trigger.
  // Show the tutorial modal on arrival if the user is signed in, hasn't
  // dismissed the journey, and hasn't completed step 7 yet. Idempotent: once
  // step 7 is marked, future visits won't re-show the modal.
  //
  // We MUST gate on `hydrated` — the store defaults to `completedSteps: []`
  // before the server preferences load, which would otherwise re-trigger
  // the tutorial on every refresh even for users who already finished the
  // journey.
  //
  // Also close the Guide panel while the tutorial is up — the two overlap
  // visually and the Guide's backdrop (z-40) blocks clicks on the modal.
  const hydrated = useGuideStore(s => s.hydrated)
  useEffect(() => {
    if (!session?.user?.id) return
    if (!hydrated) return
    const { journeyProgress } = useGuideStore.getState()
    const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
    if (dismissedAt) return
    if (completedSteps.includes(7)) return
    useGuideStore.getState().close()
    setShowTutorial(true)
  }, [session?.user?.id, hydrated])

  function closeTutorial() {
    // Intelligent Guide v1 — the legacy "dismiss tutorial → step 7" client-
    // trigger was removed. New step 7 fires server-side when the user's bot
    // gets a finalPosition in a completed tournament (tournamentBridge.js).
    setShowTutorial(false)
  }

  // Filter/search/paginate state — all persisted in the URL so the browser's
  // Back button restores position after clicking into a tournament.
  const statusFilter = searchParams.get('status') ?? ''
  const dateRange    = searchParams.get('date')   ?? 'week'   // default: past week
  const searchTerm   = searchParams.get('q')      ?? ''
  const page         = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const PAGE_SIZE    = 12

  // Debounced search input mirror — typed characters land in the URL after 250ms.
  const [searchInput, setSearchInput] = useState(searchTerm)
  useEffect(() => {
    const t = setTimeout(() => updateParams({ q: searchInput.trim() || null, page: null }), 250)
    return () => clearTimeout(t)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateParams(updates) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === undefined || v === '') next.delete(k)
        else next.set(k, String(v))
      }
      return next
    }, { replace: true })
  }

  const setStatusFilter = v => updateParams({ status: v || null, page: null })
  const setDateRange    = v => updateParams({ date:   v === 'week' ? null : v, page: null })
  const setPage         = n => updateParams({ page:   n === 1 ? null : n })

  useEffect(() => {
    if (!session?.user?.id) { setToken(null); setDbUserId(null); return }
    getToken().then(async t => {
      setToken(t)
      // Resolve the DB user ID (different from BetterAuth session user.id)
      try {
        const cacheKey = `aiarena_dbuser_${session.user.id}`
        const cached = sessionStorage.getItem(cacheKey)
        if (cached) { setDbUserId(JSON.parse(cached).id); return }
        const res = await fetch(`${API_BASE}/api/v1/users/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        })
        if (res.ok) {
          const { user } = await res.json()
          setDbUserId(user.id)
          sessionStorage.setItem(cacheKey, JSON.stringify(user))
        }
      } catch {}
    }).catch(() => {})
  }, [session?.user?.id])

  // Phase 20.3 — SWR via the shared hook. Cache key flips on token
  // presence so anon / authed lists don't share an entry. The fetcher
  // returns the filtered list directly so consumers see a stable shape.
  const tournamentsFetcher = useCallback(async () => {
    const data = await tournamentApi.list({}, token)
    const list = Array.isArray(data) ? data : (data.tournaments ?? [])
    return list.filter(t => t.status !== 'DRAFT' && t.status !== 'CANCELLED')
  }, [token])
  const {
    data:    tournamentsData,
    isLoading: loading,
    error:   listError,
    refresh: load,
  } = useSWRish(
    `tournaments:list:${token ? 'authed' : 'anon'}`,
    tournamentsFetcher,
    { maxAgeMs: 60_000 },
  )
  const tournaments = tournamentsData ?? []
  const error = listError ? 'Failed to load tournaments.' : null

  useEffect(() => {
    if (!autoRegisterId || !token || loading || tournaments.length === 0) return
    const target = tournaments.find(t => t.id === autoRegisterId && t.status === 'REGISTRATION_OPEN')
    if (!target) return
    tournamentApi.register(autoRegisterId, token)
      .then(() => { setAutoRegisterId(null); load() })
      .catch(() => setAutoRegisterId(null))
  }, [autoRegisterId, token, loading, tournaments]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tier 2 SSE — any tournament:* event refetches the list ─────────────────
  useEventStream({
    channels: ['tournament:'],
    onEvent: () => load(),
  })

  // ── Client-side filter + search + paginate ─────────────────────────────────
  // The list endpoint doesn't support q/since/limit/page yet; running these in
  // the browser is fine at current scale. Promote server-side when we start
  // counting tournaments in the hundreds.
  const filtered = useMemo(() => {
    const { since, until } = resolveDateRange(dateRange)
    const q = searchTerm.trim().toLowerCase()
    return tournaments.filter(t => {
      if (statusFilter && t.status !== statusFilter) return false
      if (q && !(t.name?.toLowerCase().includes(q))) return false
      if (since || until) {
        const ref = t.startTime ?? t.createdAt
        if (!ref) return false
        const refMs = new Date(ref).getTime()
        if (since && refMs < new Date(since).getTime()) return false
        if (until && refMs >= new Date(until).getTime()) return false
      }
      return true
    })
  }, [tournaments, statusFilter, dateRange, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage   = Math.min(page, totalPages)
  const pageSlice  = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  )

  // Absolute-positioned within `main` (AppLayout.jsx:480 — `flex-1 relative`).
  // Main has a bounded flex share of the viewport, and our intrinsic size is 0
  // (because we're absolutely positioned), so main never grows to push the
  // document past the viewport — the outer browser scrollbar stays away and
  // only the ListTable body scrolls.
  const hasResults = !loading && filtered.length > 0

  return (
    <div className="absolute inset-0 flex justify-center overflow-hidden">
     <div className="max-w-5xl w-full h-full px-4 py-5 flex flex-col gap-4 overflow-hidden">
      <div className="shrink-0 pb-3 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-2xl sm:text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Tournaments
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Compete in structured brackets and climb the ranks.
        </p>
      </div>

      {/* Controls row — status pills + date dropdown on one line, search fills
          the rest. On very narrow viewports the row wraps; search stays full
          width beneath the pills. */}
      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <FilterBar value={statusFilter} onChange={setStatusFilter} />
        <DateFilter value={dateRange} onChange={setDateRange} />
        <div className="ml-auto w-full sm:w-64">
          <SearchBar value={searchInput} onChange={setSearchInput} placeholder="Search tournaments…" />
        </div>
      </div>

      {error && (
        <p className="shrink-0 text-sm text-center py-2" style={{ color: 'var(--color-red-600)' }}>{error}</p>
      )}

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <LoadingSpinner />
        </div>
      )}

      {hasResults && (
        <>
          <div className="flex-1 min-h-0">
            <ListTable fill columns={isMobile ? ['46%', '14%', '18%', '22%'] : ['42%', '20%', '10%', '14%', '14%']}>
              <thead>
                <tr>
                  <ListTh>Tournament</ListTh>
                  {!isMobile && <ListTh>Starts</ListTh>}
                  <ListTh align="center">Players</ListTh>
                  <ListTh align="center">Status</ListTh>
                  <ListTh align="right"><span className="sr-only">Action</span></ListTh>
                </tr>
              </thead>
              <tbody>
                {pageSlice.map((t, i) => (
                  <TournamentRow
                    key={t.id}
                    tournament={t}
                    token={token}
                    dbUserId={dbUserId}
                    isMobile={isMobile}
                    onRegistered={() => load()}
                    last={i === pageSlice.length - 1}
                  />
                ))}
              </tbody>
            </ListTable>
          </div>
          <div className="shrink-0">
            <ListPagination
              page={safePage}
              totalPages={totalPages}
              total={filtered.length}
              limit={PAGE_SIZE}
              onPageChange={setPage}
              noun="tournaments"
            />
          </div>
        </>
      )}

      {!loading && filtered.length === 0 && !error && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2">
          <p className="text-3xl">⊕</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No tournaments match</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {tournaments.length === 0
              ? 'Check back soon for upcoming events.'
              : 'Try a different filter, date range, or search term.'}
          </p>
        </div>
      )}
     </div>
      {showTutorial && <JourneyTutorialModal onClose={closeTutorial} />}
    </div>
  )
}
