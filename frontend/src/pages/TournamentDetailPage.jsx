// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { tournamentApi } from '../lib/tournamentApi.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useRolesStore } from '../store/rolesStore.js'
import { useTournamentSocket } from '../hooks/useTournamentSocket.js'
import { connectSocket } from '../lib/socket.js'

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  DRAFT:               { bg: 'var(--color-gray-100)',   text: 'var(--text-muted)',      label: 'Draft' },
  REGISTRATION_OPEN:   { bg: 'var(--color-teal-50)',    text: 'var(--color-teal-700)',  label: 'Registration Open' },
  REGISTRATION_CLOSED: { bg: 'var(--color-amber-50)',   text: 'var(--color-amber-700)', label: 'Registration Closed' },
  IN_PROGRESS:         { bg: 'var(--color-blue-50)',    text: 'var(--color-blue-700)',  label: 'In Progress' },
  COMPLETED:           { bg: 'var(--color-gray-100)',   text: 'var(--text-secondary)',  label: 'Completed' },
  CANCELLED:           { bg: 'var(--color-red-50)',     text: 'var(--color-red-600)',   label: 'Cancelled' },
}

const PARTICIPANT_STATUS_STYLES = {
  REGISTERED:  { bg: 'var(--color-blue-50)',   text: 'var(--color-blue-700)',  label: 'Registered' },
  ELIMINATED:  { bg: 'var(--color-gray-100)',  text: 'var(--text-muted)',     label: 'Eliminated' },
  WITHDRAWN:   { bg: 'var(--color-red-50)',    text: 'var(--color-red-500)',  label: 'Withdrawn' },
}

function StatusBadge({ status, styles = STATUS_STYLES }) {
  const s = styles[status] ?? STATUS_STYLES.DRAFT
  return (
    <span
      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  )
}

// ── Spinner / Error ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorMsg({ children }) {
  return <p className="text-sm text-center py-4" style={{ color: 'var(--color-red-600)' }}>{children}</p>
}

// ── Bracket visualization ─────────────────────────────────────────────────────

/**
 * Given rounds + participants, renders a horizontally-scrollable bracket.
 * Each column = one round, each cell = one match.
 * Works for SINGLE_ELIM up to 32 players (5 rounds).
 * CSS-only — no canvas, no external library.
 */
function TournamentBracket({ rounds, participants }) {
  if (!rounds || rounds.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
        Bracket will appear once the tournament starts.
      </p>
    )
  }

  // Build a lookup: participantId → displayName
  const nameOf = {}
  ;(participants ?? []).forEach(p => {
    nameOf[p.id] = p.user?.displayName ?? `Seed ${p.seedPosition}`
  })

  const sortedRounds = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)

  return (
    <div className="overflow-x-auto pb-2">
      <div
        className="flex gap-0 items-start"
        style={{ minWidth: `${sortedRounds.length * 200}px` }}
      >
        {sortedRounds.map((round, roundIdx) => {
          const sortedMatches = [...round.matches].sort((a, b) => {
            // Keep original order by id prefix
            return a.id < b.id ? -1 : 1
          })
          const totalRounds = sortedRounds.length
          const isLastRound = roundIdx === totalRounds - 1

          return (
            <div
              key={round.id}
              className="flex flex-col flex-1"
              style={{ minWidth: '180px' }}
            >
              {/* Round label */}
              <div
                className="text-[10px] font-semibold uppercase tracking-widest text-center py-2 border-b"
                style={{ color: 'var(--text-muted)', borderColor: 'var(--border-default)' }}
              >
                {isLastRound && totalRounds > 1 ? 'Final' : `Round ${round.roundNumber}`}
              </div>

              {/* Matches */}
              <div className="flex flex-col" style={{ gap: '0' }}>
                {sortedMatches.map((match, matchIdx) => (
                  <BracketMatch
                    key={match.id}
                    match={match}
                    nameOf={nameOf}
                    matchIndex={matchIdx}
                    matchCount={sortedMatches.length}
                    roundIndex={roundIdx}
                    totalRounds={totalRounds}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BracketMatch({ match, nameOf, matchIndex, matchCount, roundIndex, totalRounds }) {
  const p1Name = match.participant1Id ? (nameOf[match.participant1Id] ?? 'TBD') : 'BYE'
  const p2Name = match.participant2Id ? (nameOf[match.participant2Id] ?? 'TBD') : 'BYE'
  const isCompleted  = match.status === 'COMPLETED'
  const isInProgress = match.status === 'IN_PROGRESS'

  const p1Won = isCompleted && match.winnerId === match.participant1Id
  const p2Won = isCompleted && match.winnerId === match.participant2Id

  // Vertical spacing: later rounds have more space between matches
  const spacingMultiplier = Math.pow(2, roundIndex)
  const verticalPad = 12 * spacingMultiplier

  return (
    <div
      className="relative flex flex-col"
      style={{ paddingTop: verticalPad, paddingBottom: verticalPad }}
    >
      {/* Match card */}
      <div
        className="mx-2 rounded-lg border overflow-hidden"
        style={{
          borderColor: isInProgress ? 'var(--color-blue-300)' : 'var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: isInProgress ? '0 0 0 2px var(--color-blue-100)' : undefined,
        }}
      >
        {/* Participant 1 */}
        <div
          className="flex items-center justify-between px-2 py-1.5 gap-2 border-b"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: p1Won ? 'var(--color-teal-50)' : undefined,
            opacity: isCompleted && !p1Won ? 0.5 : 1,
          }}
        >
          <span
            className={`text-xs truncate max-w-[100px] ${p1Won ? 'font-bold' : 'font-medium'}`}
            style={{ color: p1Won ? 'var(--color-teal-700)' : 'var(--text-primary)' }}
          >
            {p1Name}
          </span>
          {(isCompleted || isInProgress) && match.participant1Id && (
            <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {match.p1Wins ?? 0}
            </span>
          )}
        </div>
        {/* Participant 2 */}
        <div
          className="flex items-center justify-between px-2 py-1.5 gap-2"
          style={{
            backgroundColor: p2Won ? 'var(--color-teal-50)' : undefined,
            opacity: isCompleted && !p2Won ? 0.5 : 1,
          }}
        >
          <span
            className={`text-xs truncate max-w-[100px] ${p2Won ? 'font-bold' : 'font-medium'}`}
            style={{ color: p2Won ? 'var(--color-teal-700)' : 'var(--text-primary)' }}
          >
            {p2Name}
          </span>
          {(isCompleted || isInProgress) && match.participant2Id && (
            <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {match.p2Wins ?? 0}
            </span>
          )}
        </div>
      </div>

      {/* Connector line to next round (right edge) */}
      {roundIndex < totalRounds - 1 && (
        <div
          className="absolute right-0 top-1/2 w-2 border-t"
          style={{ borderColor: 'var(--border-default)', transform: 'translateY(-50%)' }}
        />
      )}
    </div>
  )
}

// ── Admin controls ────────────────────────────────────────────────────────────

function AdminControls({ tournament, token, onRefresh }) {
  const [busy, setBusy]   = useState(null)
  const [err, setErr]     = useState(null)
  const [success, setSuccess] = useState(null)

  async function act(action, label) {
    if (!confirm(`${label} this tournament?`)) return
    setBusy(action)
    setErr(null)
    setSuccess(null)
    try {
      await tournamentApi[action](tournament.id, token)
      setSuccess(`${label} successful.`)
      setTimeout(() => setSuccess(null), 3000)
      onRefresh()
    } catch (e) {
      setErr(e.message || `${label} failed.`)
    } finally {
      setBusy(null)
    }
  }

  const { status } = tournament
  const canPublish = status === 'DRAFT'
  const canStart   = status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED'
  const canCancel  = status !== 'COMPLETED' && status !== 'CANCELLED'

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--color-amber-200)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ backgroundColor: 'var(--color-amber-50)', color: 'var(--color-amber-700)' }}
        >
          Admin
        </span>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Tournament Controls</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {canPublish && (
          <Link
            to={`/admin/tournaments`}
            className="text-xs px-3 py-1.5 rounded-lg border font-semibold no-underline"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Edit
          </Link>
        )}
        {canPublish && (
          <button
            onClick={() => act('publish', 'Publish')}
            disabled={busy === 'publish'}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-teal-500), var(--color-teal-700))' }}
          >
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </button>
        )}
        {canStart && (
          <button
            onClick={() => act('start', 'Start')}
            disabled={busy === 'start'}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            {busy === 'start' ? 'Starting…' : 'Start Tournament'}
          </button>
        )}
        {canCancel && (
          <button
            onClick={() => act('cancel', 'Cancel')}
            disabled={!!busy}
            className="text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors hover:bg-[var(--color-red-50)] disabled:opacity-50"
            style={{ borderColor: 'var(--color-red-300)', color: 'var(--color-red-600)' }}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
      {err     && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
      {success && <p className="text-xs" style={{ color: 'var(--color-teal-600)' }}>{success}</p>}
    </div>
  )
}

// ── Registration panel ────────────────────────────────────────────────────────

const NOTIF_PREF_LABELS = {
  AS_PLAYED:          'after each match',
  END_OF_TOURNAMENT:  'when tournament ends',
}

function RegistrationPanel({ tournament, token, userId, onRefresh }) {
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState(null)
  const [notifPref, setNotifPref] = useState('AS_PLAYED')

  const participants = tournament.participants ?? []
  const myParticipant = userId
    ? participants.find(p => p.userId === userId)
    : null
  const isRegistered = !!myParticipant && myParticipant.status !== 'WITHDRAWN'
  const participantCount = participants.filter(p => p.status !== 'WITHDRAWN').length

  async function toggleRegistration() {
    if (!token) return
    setBusy(true)
    setErr(null)
    try {
      if (isRegistered) {
        await tournamentApi.withdraw(tournament.id, token)
      } else {
        await tournamentApi.register(tournament.id, token, { resultNotifPref: notifPref })
      }
      onRefresh()
    } catch (e) {
      setErr(e.message || 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Registration
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {participantCount}
            {tournament.maxParticipants ? `/${tournament.maxParticipants}` : ''} registered
          </p>
        </div>
        {token ? (
          <button
            onClick={toggleRegistration}
            disabled={busy}
            className="text-xs px-4 py-2 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{
              background: isRegistered
                ? 'linear-gradient(135deg, var(--color-orange-500), var(--color-orange-700))'
                : 'linear-gradient(135deg, var(--color-teal-500), var(--color-teal-700))',
            }}
          >
            {busy ? (isRegistered ? 'Withdrawing…' : 'Joining…') : (isRegistered ? 'Withdraw' : 'Register')}
          </button>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sign in to register</p>
        )}
      </div>

      {/* Notification preference — picker when not yet registered, read-only when registered */}
      {token && (
        isRegistered ? (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Notifying: <span style={{ color: 'var(--text-secondary)' }}>
              {NOTIF_PREF_LABELS[myParticipant.resultNotifPref] ?? NOTIF_PREF_LABELS.AS_PLAYED}
            </span>
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Notify me:</span>
            {Object.entries(NOTIF_PREF_LABELS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="notifPref"
                  value={value}
                  checked={notifPref === value}
                  onChange={() => setNotifPref(value)}
                  className="accent-[var(--color-teal-500)]"
                />
                <span className="text-xs" style={{ color: notifPref === value ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                  {label.charAt(0).toUpperCase() + label.slice(1)}
                </span>
              </label>
            ))}
          </div>
        )
      )}

      {err && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
      {tournament.registrationOpenAt && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Open: {new Date(tournament.registrationOpenAt).toLocaleString()}
          {tournament.registrationCloseAt && (
            <> – {new Date(tournament.registrationCloseAt).toLocaleString()}</>
          )}
        </p>
      )}
    </div>
  )
}

// ── Mixed match banner ────────────────────────────────────────────────────────

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],             // diagonals
]

function checkWinner(cells) {
  for (const [a, b, c] of WIN_LINES) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) {
      return cells[a] // 'X' or 'O'
    }
  }
  return cells.every(Boolean) ? 'DRAW' : null
}

function MixedMatchBoard({ matchId, tournament, userId, token, onDone }) {
  const participants = tournament.participants ?? []
  const myParticipant = participants.find(p => p.userId === userId)

  // Determine p1/p2 by seedPosition (lower seed = p1) or id sort fallback
  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.seedPosition != null && b.seedPosition != null) return a.seedPosition - b.seedPosition
    return a.id < b.id ? -1 : 1
  })

  // Find the two participants in this match — we know one is the current user.
  // We need to find the opponent; use tournament.rounds to locate the match.
  const myMark = (() => {
    if (!myParticipant) return 'X'
    const p1 = sortedParticipants[0]
    return p1?.id === myParticipant.id ? 'X' : 'O'
  })()
  const botMark = myMark === 'X' ? 'O' : 'X'

  const [cells, setCells]       = useState(Array(9).fill(null))
  const [current, setCurrent]   = useState('X') // X always goes first
  const [outcome, setOutcome]   = useState(null) // null | 'X' | 'O' | 'DRAW'
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState(null)

  // When it's the bot's turn, fire after a short delay
  useEffect(() => {
    if (outcome || current !== botMark) return
    const timer = setTimeout(() => {
      setCells(prev => {
        const empty = prev.map((v, i) => v === null ? i : null).filter(i => i !== null)
        if (empty.length === 0) return prev
        const pick = empty[Math.floor(Math.random() * empty.length)]
        const next = [...prev]
        next[pick] = botMark
        const result = checkWinner(next)
        if (result) setOutcome(result)
        else setCurrent(myMark)
        return next
      })
    }, 400)
    return () => clearTimeout(timer)
  }, [current, outcome, botMark, myMark])

  function handleCellClick(idx) {
    if (outcome || cells[idx] || current !== myMark) return
    const next = [...cells]
    next[idx] = myMark
    const result = checkWinner(next)
    setCells(next)
    if (result) {
      setOutcome(result)
    } else {
      setCurrent(botMark)
    }
  }

  // Submit result when outcome is determined
  useEffect(() => {
    if (!outcome || submitting) return

    async function submit() {
      setSubmitting(true)
      setSubmitErr(null)

      // Determine p1 and p2 participants (by sortedParticipants order)
      // We only have the current user's participant; the opponent participant id
      // might not be in participants list if they are a bot (no userId).
      // Find the match in tournament.rounds to get both participant ids.
      let p1Id = null
      let p2Id = null
      for (const round of (tournament.rounds ?? [])) {
        for (const match of (round.matches ?? [])) {
          if (match.id === matchId) {
            p1Id = match.participant1Id
            p2Id = match.participant2Id
            break
          }
        }
        if (p1Id) break
      }

      // Fallback: use sorted participants
      if (!p1Id) {
        p1Id = sortedParticipants[0]?.id ?? null
        p2Id = sortedParticipants[1]?.id ?? null
      }

      // myParticipant maps to either p1 or p2
      const myParticipantId = myParticipant?.id ?? null
      const opponentParticipantId = myParticipantId === p1Id ? p2Id : p1Id

      let winnerId = null
      let p1Wins = 0
      let p2Wins = 0
      let drawGames = 0

      if (outcome === 'DRAW') {
        drawGames = 1
        winnerId = null
      } else {
        // outcome is 'X' or 'O' — the mark that won
        const winnerIsMe = outcome === myMark
        if (winnerIsMe) {
          winnerId = myParticipantId
        } else {
          winnerId = opponentParticipantId
        }
        // p1Wins/p2Wins: is winnerId p1 or p2?
        if (winnerId === p1Id) p1Wins = 1
        else if (winnerId === p2Id) p2Wins = 1
      }

      try {
        await tournamentApi.completeMatch(matchId, { winnerId, p1Wins, p2Wins, drawGames }, token)
        onDone()
      } catch (e) {
        setSubmitErr(e.message || 'Failed to submit result.')
        setSubmitting(false)
      }
    }

    submit()
  }, [outcome]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusText = (() => {
    if (submitting) return 'Submitting result…'
    if (outcome === 'DRAW') return "It's a draw!"
    if (outcome === myMark) return 'You win!'
    if (outcome) return 'Bot wins!'
    if (current === myMark) return 'Your turn'
    return 'Bot is thinking…'
  })()

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-center" style={{ color: 'var(--text-secondary)' }}>
        {statusText}
      </p>

      {/* 3×3 board */}
      <div
        className="grid mx-auto"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '6px',
          maxWidth: '240px',
        }}
      >
        {cells.map((cell, idx) => {
          const isClickable = !outcome && !cell && current === myMark
          return (
            <button
              key={idx}
              onClick={() => handleCellClick(idx)}
              disabled={!isClickable}
              className="flex items-center justify-center rounded-lg border font-bold text-2xl transition-all"
              style={{
                height: '72px',
                borderColor: 'var(--border-default)',
                backgroundColor: cell
                  ? cell === 'X' ? 'var(--color-teal-50)' : 'var(--color-orange-50)'
                  : isClickable ? 'var(--bg-surface)' : 'var(--bg-surface)',
                color: cell === 'X' ? 'var(--color-teal-700)' : 'var(--color-orange-500)',
                cursor: isClickable ? 'pointer' : 'default',
                boxShadow: isClickable ? 'var(--shadow-card)' : 'none',
                opacity: outcome && !cell ? 0.4 : 1,
              }}
            >
              {cell ?? (isClickable ? '' : '')}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
        <span>You: <strong style={{ color: 'var(--color-teal-700)' }}>{myMark}</strong></span>
        <span>Bot: <strong style={{ color: 'var(--color-orange-500)' }}>{botMark}</strong></span>
      </div>

      {submitErr && (
        <p className="text-xs text-center" style={{ color: 'var(--color-red-600)' }}>{submitErr}</p>
      )}
    </div>
  )
}

// ── PVP match banner ──────────────────────────────────────────────────────────

function PvpMatchBanner({ tournament, userBetterAuthId, token, matchEvent, onDismiss }) {
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)
  const [err, setErr]         = useState(null)

  if (!matchEvent || tournament.mode !== 'HVH') return null

  const { matchId, participant1UserId, participant2UserId, bestOfN } = matchEvent
  const isParticipant = userBetterAuthId &&
    (userBetterAuthId === participant1UserId || userBetterAuthId === participant2UserId)
  if (!isParticipant) return null

  function handleJoin() {
    setJoining(true)
    setErr(null)
    const socket = connectSocket()

    function cleanup() {
      socket.off('tournament:room:ready', onReady)
      socket.off('error', onError)
    }

    function onReady({ slug, tournamentId }) {
      cleanup()
      onDismiss()
      navigate(`/play?join=${slug}&tournamentMatch=${matchId}&tournamentId=${tournamentId}`)
    }

    function onError({ message }) {
      cleanup()
      setJoining(false)
      setErr(message || 'Failed to join match room')
    }

    socket.once('tournament:room:ready', onReady)
    socket.once('error', onError)
    getToken().then(authToken => {
      socket.emit('tournament:room:join', { matchId, authToken })
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <div className="space-y-1 text-center">
          <div
            className="inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-0.5 rounded-full mb-1"
            style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
          >
            Match Ready
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Your tournament match is ready
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Best of {bestOfN ?? 1} series. Play against your opponent now.
          </p>
        </div>

        {err && <p className="text-xs text-center" style={{ color: 'var(--color-red-600)' }}>{err}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleJoin}
            disabled={joining}
            className="btn btn-primary flex-1"
          >
            {joining ? 'Joining…' : 'Join Match'}
          </button>
          <button
            onClick={onDismiss}
            disabled={joining}
            className="btn"
            style={{ color: 'var(--text-secondary)' }}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}

function MixedMatchBanner({ tournament, userId, token, matchEvent, onDismiss }) {
  if (!matchEvent || tournament.mode !== 'MIXED') return null

  const { matchId, participant1UserId, participant2UserId } = matchEvent
  const isParticipant = userId && (userId === participant1UserId || userId === participant2UserId)
  if (!isParticipant) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        {/* Header */}
        <div className="space-y-1 text-center">
          <div
            className="inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-0.5 rounded-full mb-1"
            style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
          >
            Match Ready
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Your turn to play
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Play your tournament match below. The result will be submitted automatically.
          </p>
        </div>

        <MixedMatchBoard
          matchId={matchId}
          tournament={tournament}
          userId={userId}
          token={token}
          onDone={onDismiss}
        />
      </div>
    </div>
  )
}

// ── Participants table ────────────────────────────────────────────────────────

function ParticipantTable({ participants }) {
  if (!participants || participants.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
        No participants yet.
      </p>
    )
  }

  const sorted = [...participants].sort((a, b) => (a.seedPosition ?? 999) - (b.seedPosition ?? 999))

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="overflow-x-auto" style={{ maxHeight: '400px', overflowY: 'auto' }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {['Seed', 'Player', 'ELO', 'Status'].map(col => (
                <th
                  key={col}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider sticky top-0"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderBottom: '2px solid var(--border-default)',
                    color: 'var(--text-muted)',
                    zIndex: 1,
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr
                key={p.id}
                className="transition-colors hover:bg-[var(--bg-surface-hover)]"
                style={{
                  borderBottom: i < sorted.length - 1 ? '1px solid var(--border-default)' : 'none',
                  opacity: p.status === 'WITHDRAWN' || p.status === 'ELIMINATED' ? 0.55 : 1,
                }}
              >
                <td className="px-4 py-3 text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {p.seedPosition ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {p.user?.displayName ?? `User ${p.userId.slice(0, 6)}`}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>
                  {p.eloAtRegistration ? Math.round(p.eloAtRegistration) : '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={p.status} styles={PARTICIPANT_STATUS_STYLES} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FinalStandingsTable({ participants }) {
  const placed = [...participants]
    .filter(p => p.finalPosition != null)
    .sort((a, b) => a.finalPosition - b.finalPosition)

  if (placed.length === 0) return null

  const MEDALS = ['🥇', '🥈', '🥉']

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="overflow-x-auto" style={{ maxHeight: '320px', overflowY: 'auto' }}>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              {['Place', 'Player', 'ELO at Start'].map(col => (
                <th
                  key={col}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider sticky top-0"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderBottom: '2px solid var(--border-default)',
                    color: 'var(--text-muted)',
                    zIndex: 1,
                  }}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placed.map((p, i) => (
              <tr
                key={p.id}
                className="transition-colors hover:bg-[var(--bg-surface-hover)]"
                style={{ borderBottom: i < placed.length - 1 ? '1px solid var(--border-default)' : 'none' }}
              >
                <td className="px-4 py-3 text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {MEDALS[p.finalPosition - 1] ?? `#${p.finalPosition}`}
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {p.user?.displayName ?? `User ${p.userId.slice(0, 6)}`}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>
                  {p.eloAtRegistration ? Math.round(p.eloAtRegistration) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2
        className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: 'var(--text-muted)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TournamentDetailPage() {
  const { id } = useParams()
  const { data: session } = useOptimisticSession()
  const rolesStore = useRolesStore()
  const [tournament, setTournament] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [token, setToken]           = useState(null)
  const [activeMatchEvent, setActiveMatchEvent] = useState(null)

  const { lastEvent } = useTournamentSocket()

  const isAdmin          = session?.user?.role === 'admin' || rolesStore.hasRole('TOURNAMENT_ADMIN')
  const userId           = session?.user?.id ?? null
  // BetterAuth ID — matches participant1UserId / participant2UserId in match:ready events
  const userBetterAuthId = session?.user?.id ?? null

  useEffect(() => {
    if (session?.user?.id) {
      getToken().then(setToken).catch(() => {})
    } else {
      setToken(null)
    }
  }, [session?.user?.id])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await tournamentApi.get(id, token)
      setTournament(data.tournament ?? data)
    } catch (e) {
      setError(e.message || 'Failed to load tournament.')
    } finally {
      setLoading(false)
    }
  }, [id, token])

  useEffect(() => { load() }, [load])

  // Refresh on relevant socket events; capture match:ready for MIXED mode
  useEffect(() => {
    if (!lastEvent || lastEvent.data?.tournamentId !== id) return
    if (lastEvent.channel === 'tournament:match:ready') {
      setActiveMatchEvent(lastEvent.data)
    }
    load()
  }, [lastEvent]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />
  if (error)   return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Link to="/tournaments" className="text-sm" style={{ color: 'var(--color-blue-600)' }}>
        ← Back to Tournaments
      </Link>
      <ErrorMsg>{error}</ErrorMsg>
    </div>
  )
  if (!tournament) return null

  const t = tournament

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* PVP mode match banner */}
      {tournament && activeMatchEvent && (
        <PvpMatchBanner
          tournament={tournament}
          userBetterAuthId={userBetterAuthId}
          token={token}
          matchEvent={activeMatchEvent}
          onDismiss={() => setActiveMatchEvent(null)}
        />
      )}

      {/* MIXED mode match banner */}
      {tournament && activeMatchEvent && (
        <MixedMatchBanner
          tournament={tournament}
          userId={userId}
          token={token}
          matchEvent={activeMatchEvent}
          onDismiss={() => { setActiveMatchEvent(null); load() }}
        />
      )}

      {/* Back link */}
      <Link to="/tournaments" className="text-sm" style={{ color: 'var(--color-blue-600)' }}>
        ← Tournaments
      </Link>

      {/* Header */}
      <div className="pb-4 border-b space-y-2" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1
              className="text-3xl font-bold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
            >
              {t.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <StatusBadge status={t.status} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t.game?.toUpperCase()} · {t.mode} · {t.format} · {t.bracketType?.replace('_', ' ')}
              </span>
              {t.bestOfN && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Best of {t.bestOfN}
                </span>
              )}
            </div>
          </div>
        </div>

        {t.description && (
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t.description}</p>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t.startTime && (
            <span>Start: {new Date(t.startTime).toLocaleString()}</span>
          )}
          {t.registrationOpenAt && (
            <span>Reg opens: {new Date(t.registrationOpenAt).toLocaleString()}</span>
          )}
          {t.registrationCloseAt && (
            <span>Reg closes: {new Date(t.registrationCloseAt).toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Admin controls */}
      {isAdmin && (
        <AdminControls tournament={t} token={token} onRefresh={load} />
      )}

      {/* Registration panel */}
      {t.status === 'REGISTRATION_OPEN' && (
        <Section title="Registration">
          <RegistrationPanel
            tournament={t}
            token={token}
            userId={userId}
            onRefresh={load}
          />
        </Section>
      )}

      {/* Bracket */}
      {(t.rounds?.length > 0 || t.status === 'IN_PROGRESS' || t.status === 'COMPLETED') && (
        <Section title="Bracket">
          <div
            className="rounded-xl border p-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <TournamentBracket
              rounds={t.rounds ?? []}
              participants={t.participants ?? []}
            />
          </div>
        </Section>
      )}

      {/* Final Standings */}
      {t.status === 'COMPLETED' && (
        <Section title="Final Standings">
          <FinalStandingsTable participants={t.participants ?? []} />
        </Section>
      )}

      {/* Participants */}
      <Section title={`Participants (${(t.participants ?? []).length})`}>
        <ParticipantTable participants={t.participants ?? []} />
      </Section>
    </div>
  )
}
