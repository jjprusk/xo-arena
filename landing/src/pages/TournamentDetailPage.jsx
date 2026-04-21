// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { tournamentApi } from '../lib/tournamentApi.js'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useEventStream } from '../lib/useEventStream.js'
import { connectSocket } from '../lib/socket.js'
import { useGameSDK } from '../lib/useGameSDK.js'
import { ListTable, ListTh, ListTr, ListTd } from '../components/ui/ListTable.jsx'
import { useReplaySDK } from '../lib/useReplaySDK.js'
import { meta as xoMeta } from '@callidity/game-xo'
import { useSoundStore } from '../store/soundStore.js'

const XOGame = lazy(() => import('@callidity/game-xo'))

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

const STATUS_STYLES = {
  DRAFT:               { bg: 'var(--color-gray-100)',   text: 'var(--text-muted)',      label: 'Draft' },
  REGISTRATION_OPEN:   { bg: 'var(--color-slate-100)',  text: 'var(--color-slate-700)', label: 'Registration Open' },
  REGISTRATION_CLOSED: { bg: 'var(--color-amber-50)',   text: 'var(--color-amber-700)', label: 'Registration Closed' },
  IN_PROGRESS:         { bg: 'var(--color-blue-50)',    text: 'var(--color-blue-700)',  label: 'In Progress' },
  COMPLETED:           { bg: 'var(--color-gray-100)',   text: 'var(--text-secondary)',  label: 'Completed' },
  CANCELLED:           { bg: 'var(--color-red-50)',     text: 'var(--color-red-600)',   label: 'Cancelled' },
}

const PARTICIPANT_STATUS_STYLES = {
  REGISTERED:  { bg: 'var(--color-blue-50)',   text: 'var(--color-blue-700)',  label: 'Registered' },
  ACTIVE:      { bg: 'var(--color-slate-100)', text: 'var(--color-slate-700)', label: 'Active' },
  ELIMINATED:  { bg: 'var(--color-gray-100)',  text: 'var(--text-muted)',      label: 'Eliminated' },
  WITHDRAWN:   { bg: 'var(--color-red-50)',    text: 'var(--color-red-500)',   label: 'Withdrawn' },
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
      <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ErrorMsg({ children }) {
  return <p className="text-sm text-center py-4" style={{ color: 'var(--color-red-600)' }}>{children}</p>
}

// ── Player card popup ─────────────────────────────────────────────────────────

function PlayerCard({ userId, onClose }) {
  const [profile, setProfile] = useState(null)
  const [stats,   setStats]   = useState(null)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.users.getProfile(userId), api.users.stats(userId)])
      .then(([prof, st]) => { if (!cancelled) { setProfile(prof.user); setStats(st.stats) } })
      .catch(() => { if (!cancelled) setError('Failed to load player info.') })
    return () => { cancelled = true }
  }, [userId])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-xs rounded-2xl flex flex-col gap-3 p-4"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {profile?.displayName ?? '…'}
            </span>
            {profile?.isBot && (
              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}>
                Bot
              </span>
            )}
          </div>
          <button onClick={onClose} className="shrink-0 px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface-hover)' }}>
            ✕ Close
          </button>
        </div>

        {error && <ErrorMsg>{error}</ErrorMsg>}
        {!profile && !error && <Spinner />}

        {profile && (
          <>
            {profile.owner && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Owner: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{profile.owner.displayName}</span>
              </p>
            )}

            <div className="flex gap-3">
              <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border flex-1"
                style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>ELO</span>
                <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-blue-600)' }}>
                  {Math.round(profile.eloRating ?? 1200)}
                </span>
              </div>
              {stats && (
                <div className="flex flex-col gap-0.5 px-3 py-2 rounded-lg border flex-1"
                  style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-base)' }}>
                  <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Win Rate</span>
                  <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>
                    {stats.totalGames > 0 ? `${Math.round(stats.winRate * 100)}%` : '—'}
                  </span>
                </div>
              )}
            </div>

            {stats && stats.totalGames > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <span className="px-2 py-1 rounded font-semibold tabular-nums"
                  style={{ backgroundColor: 'var(--color-green-50)', color: 'var(--color-green-700)' }}>
                  {stats.wins}W
                </span>
                <span className="px-2 py-1 rounded font-semibold tabular-nums"
                  style={{ backgroundColor: 'var(--color-red-50)', color: 'var(--color-red-600)' }}>
                  {stats.losses}L
                </span>
                <span className="px-2 py-1 rounded font-semibold tabular-nums"
                  style={{ backgroundColor: 'var(--bg-surface-hover)', color: 'var(--text-muted)' }}>
                  {stats.draws}D
                </span>
                <span className="ml-auto" style={{ color: 'var(--text-muted)' }}>{stats.totalGames} games</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PlayerLink({ userId, children, className, style }) {
  const [open, setOpen] = useState(false)
  if (!userId) return <span className={className} style={style}>{children}</span>
  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true) }}
        className={`hover:underline text-left ${className ?? ''}`}
        style={style}
      >
        {children}
      </button>
      {open && <PlayerCard userId={userId} onClose={() => setOpen(false)} />}
    </>
  )
}

// ── Bracket visualization ─────────────────────────────────────────────────────

function TournamentBracket({ rounds, participants, onMatchClick, onMatchSpectate }) {
  if (!rounds || rounds.length === 0) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
        Bracket will appear once the tournament starts.
      </p>
    )
  }

  const nameOf   = {}
  const userIdOf = {}
  ;(participants ?? []).forEach(p => {
    nameOf[p.id]   = p.user?.displayName ?? `Seed ${p.seedPosition}`
    userIdOf[p.id] = p.user?.id ?? null
  })

  const sortedRounds = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-0 items-start" style={{ minWidth: `${sortedRounds.length * 200}px` }}>
        {sortedRounds.map((round, roundIdx) => {
          const sortedMatches = [...round.matches].sort((a, b) => a.id < b.id ? -1 : 1)
          const totalRounds = sortedRounds.length
          const isLastRound = roundIdx === totalRounds - 1

          return (
            <div key={round.id} className="flex flex-col flex-1" style={{ minWidth: '180px' }}>
              <div
                className="text-[10px] font-semibold uppercase tracking-widest text-center py-2 border-b"
                style={{ color: 'var(--text-muted)', borderColor: 'var(--border-default)' }}
              >
                {isLastRound && totalRounds > 1 ? 'Final' : `Round ${round.roundNumber}`}
              </div>
              <div className="flex flex-col">
                {sortedMatches.map((match, matchIdx) => (
                  <BracketMatch
                    key={match.id}
                    match={match}
                    nameOf={nameOf}
                    userIdOf={userIdOf}
                    matchIndex={matchIdx}
                    matchCount={sortedMatches.length}
                    roundIndex={roundIdx}
                    totalRounds={totalRounds}
                    onWatch={onMatchClick}
                    onSpectate={onMatchSpectate}
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

function BracketMatch({ match, nameOf, userIdOf, matchIndex, matchCount, roundIndex, totalRounds, onWatch, onSpectate }) {
  const p1Name   = match.participant1Id ? (nameOf[match.participant1Id] ?? 'TBD') : 'BYE'
  const p2Name   = match.participant2Id ? (nameOf[match.participant2Id] ?? 'TBD') : 'BYE'
  const p1UserId = match.participant1Id ? (userIdOf?.[match.participant1Id] ?? null) : null
  const p2UserId = match.participant2Id ? (userIdOf?.[match.participant2Id] ?? null) : null
  const isCompleted  = match.status === 'COMPLETED'
  const isInProgress = match.status === 'IN_PROGRESS'
  const isBye = !match.participant1Id || !match.participant2Id
  const p1Won = isCompleted && match.winnerId === match.participant1Id
  const p2Won = isCompleted && match.winnerId === match.participant2Id
  const drawGames = match.drawGames ?? 0
  const verticalPad = 12 * Math.pow(2, roundIndex)

  return (
    <div className="relative flex flex-col" style={{ paddingTop: verticalPad, paddingBottom: verticalPad }}>
      <div
        className="mx-2 rounded-lg border overflow-hidden"
        style={{
          borderColor: isInProgress ? 'var(--color-primary)' : 'var(--border-default)',
          backgroundColor: 'var(--bg-surface)',
        }}
      >
        <div
          className="flex items-center justify-between px-2 py-1.5 gap-2 border-b"
          style={{
            borderColor: 'var(--border-default)',
            backgroundColor: p1Won ? 'var(--color-slate-50)' : undefined,
            opacity: isCompleted && !p1Won ? 0.5 : 1,
          }}
        >
          <PlayerLink
            userId={p1UserId}
            className={`text-xs truncate max-w-[100px] ${p1Won ? 'font-bold' : 'font-medium'}`}
            style={{ color: p1Won ? 'var(--color-slate-700)' : 'var(--text-primary)' }}
          >
            {p1Name}
          </PlayerLink>
          {(isCompleted || isInProgress) && match.participant1Id && (
            <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {match.p1Wins ?? 0}
            </span>
          )}
        </div>
        <div
          className="flex items-center justify-between px-2 py-1.5 gap-2"
          style={{
            backgroundColor: p2Won ? 'var(--color-slate-50)' : undefined,
            opacity: isCompleted && !p2Won ? 0.5 : 1,
          }}
        >
          <PlayerLink
            userId={p2UserId}
            className={`text-xs truncate max-w-[100px] ${p2Won ? 'font-bold' : 'font-medium'}`}
            style={{ color: p2Won ? 'var(--color-slate-700)' : 'var(--text-primary)' }}
          >
            {p2Name}
          </PlayerLink>
          {(isCompleted || isInProgress) && match.participant2Id && (
            <span className="text-xs font-bold tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>
              {match.p2Wins ?? 0}
            </span>
          )}
        </div>
        {isCompleted && drawGames > 0 && (
          <div
            className="px-2 py-1 text-[10px] text-center border-t"
            style={{ color: 'var(--text-muted)', borderColor: 'var(--border-default)' }}
          >
            {drawGames} draw{drawGames !== 1 ? 's' : ''}
          </div>
        )}
        {isInProgress && !isBye && onSpectate && (
          <button
            onClick={() => onSpectate(match.id, `${p1Name} vs ${p2Name}`)}
            className="w-full text-[10px] py-1 font-medium border-t"
            style={{ color: 'var(--color-primary)', borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          >
            👁 Watch live
          </button>
        )}
        {isCompleted && !isBye && onWatch && (
          <button
            onClick={() => onWatch(match.id, `${p1Name} vs ${p2Name}`)}
            className="w-full text-[10px] py-1 font-medium border-t"
            style={{ color: 'var(--color-primary)', borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
          >
            ▶ Watch replay
          </button>
        )}
      </div>
      {roundIndex < totalRounds - 1 && (
        <div
          className="absolute right-0 top-1/2 w-2 border-t"
          style={{ borderColor: 'var(--border-default)', transform: 'translateY(-50%)' }}
        />
      )}
    </div>
  )
}

// ── Replay ────────────────────────────────────────────────────────────────────

function resolveThemeVars(theme, isDark) {
  return { ...theme?.tokens, ...(isDark ? theme?.dark : theme?.light) }
}

const REPLAY_SPEEDS = [0.5, 1, 2]

function ReplayControls({ controls, gameData }) {
  const { step, totalSteps, playing, speed, play, pause, stepForward, stepBack, scrub, setSpeed, reset } = controls
  const pct = totalSteps > 1 ? (step / (totalSteps - 1)) * 100 : 0
  return (
    <div className="w-full rounded-xl border p-3 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}>
      {gameData && (
        <div className="flex justify-between text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          <span><span className="font-bold" style={{ color: 'var(--color-blue-600)' }}>X</span>{' '}{gameData.player1?.displayName ?? 'Player 1'}</span>
          <span style={{ color: 'var(--text-muted)' }}>Move {step} / {totalSteps - 1}</span>
          <span>{gameData.player2?.displayName ?? 'Player 2'}{' '}<span className="font-bold" style={{ color: 'var(--color-teal-600)' }}>O</span></span>
        </div>
      )}
      <input type="range" min={0} max={totalSteps - 1} value={step} onChange={e => scrub(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ background: `linear-gradient(to right, var(--color-primary) ${pct}%, var(--border-default) ${pct}%)`, accentColor: 'var(--color-primary)' }}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button onClick={reset} className="px-2 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-hover)' }} title="Reset">⏮</button>
          <button onClick={stepBack} className="px-2 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-hover)' }} title="Step back">◀</button>
          <button onClick={playing ? pause : play} className="px-3 py-1 rounded text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}>
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={stepForward} className="px-2 py-1 rounded text-xs" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-hover)' }} title="Step forward">▶</button>
        </div>
        <div className="flex items-center gap-1">
          {REPLAY_SPEEDS.map(s => (
            <button key={s} onClick={() => setSpeed(s)} className="px-2 py-0.5 rounded text-xs font-medium"
              style={{ backgroundColor: speed === s ? 'var(--color-primary)' : 'var(--bg-surface-hover)', color: speed === s ? 'white' : 'var(--text-secondary)' }}>
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function GameReplayPlayer({ gameId }) {
  const [gameData, setGameData] = useState(null)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setGameData(null)
    setLoadError(null)
    getToken()
      .then(t => api.games.getReplay(gameId, t))
      .then(data => { if (!cancelled) setGameData(data) })
      .catch(e => { if (!cancelled) setLoadError(e?.status === 410 ? 'Replay has been purged.' : 'Failed to load replay.') })
    return () => { cancelled = true }
  }, [gameId])

  const { session, sdk, controls } = useReplaySDK({ gameData })

  if (loadError) return <ErrorMsg>{loadError}</ErrorMsg>
  if (!gameData) return <Spinner />

  const themeStyle = resolveThemeVars(xoMeta.theme, document.documentElement.classList.contains('dark'))
  return (
    <div className="flex flex-col items-center gap-3 w-full" style={themeStyle}>
      <Suspense fallback={<Spinner />}><XOGame session={session} sdk={sdk} /></Suspense>
      <ReplayControls controls={controls} gameData={gameData} />
    </div>
  )
}

function MatchReplayModal({ matchId, matchLabel, onClose }) {
  const [games, setGames]         = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [fetchError, setFetchError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setGames(null); setFetchError(null)
    getToken()
      .then(t => api.games.getByMatchId(matchId, t))
      .then(data => { if (!cancelled) setGames(data.games) })
      .catch(() => { if (!cancelled) setFetchError('Could not load games for this match.') })
    return () => { cancelled = true }
  }, [matchId])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const selectedGame = games?.[selectedIdx]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-2xl flex flex-col gap-3 p-4 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{matchLabel}</span>
          <button onClick={onClose} className="shrink-0 px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface-hover)' }}>
            ✕ Close
          </button>
        </div>

        {games && games.length > 0 && (
          <div className="flex items-center justify-center gap-1">
            <button
              onClick={() => setSelectedIdx(i => Math.max(0, i - 1))}
              disabled={selectedIdx === 0 || games.length === 1}
              className="px-2 py-1 rounded text-xs font-bold disabled:opacity-30 hover:bg-[var(--bg-surface-hover)] transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >‹‹</button>
            {games.map((_, i) => (
              <button key={i} onClick={() => setSelectedIdx(i)}
                className="w-7 h-7 rounded text-xs font-semibold transition-colors"
                style={{
                  backgroundColor: selectedIdx === i ? 'var(--color-primary)' : 'var(--bg-surface-hover)',
                  color: selectedIdx === i ? 'white' : 'var(--text-secondary)',
                }}>
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setSelectedIdx(i => Math.min(games.length - 1, i + 1))}
              disabled={selectedIdx === games.length - 1 || games.length === 1}
              className="px-2 py-1 rounded text-xs font-bold disabled:opacity-30 hover:bg-[var(--bg-surface-hover)] transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >››</button>
          </div>
        )}

        {fetchError && <ErrorMsg>{fetchError}</ErrorMsg>}
        {!games && !fetchError && <Spinner />}
        {games?.length === 0 && (
          <p className="text-sm text-center py-4" style={{ color: 'var(--text-muted)' }}>No replays recorded yet for this match.</p>
        )}
        {selectedGame && <GameReplayPlayer key={selectedGame.id} gameId={selectedGame.id} />}
      </div>
    </div>
  )
}

// ── Live spectator modal ──────────────────────────────────────────────────────

function SpectatorGame({ slug }) {
  const themeStyle = resolveThemeVars(xoMeta.theme, document.documentElement.classList.contains('dark'))
  const { session, sdk } = useGameSDK({
    gameId: 'xo',
    joinSlug: slug,
    spectate: true,
    currentUser: null,
  })
  return (
    <div className="flex flex-col items-center gap-3 w-full" style={themeStyle}>
      <Suspense fallback={<Spinner />}>
        {session ? <XOGame session={session} sdk={sdk} /> : <Spinner />}
      </Suspense>
    </div>
  )
}

function MatchSpectateModal({ matchId, matchLabel, onClose }) {
  const [slug, setSlug]       = useState(null)
  const [fetching, setFetching] = useState(true)
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.tables.getActiveByMatchId(matchId)
      .then(data => {
        if (!cancelled) {
          if (data.slug) setSlug(data.slug)
          else setFetchError('No live game in progress for this match.')
          setFetching(false)
        }
      })
      .catch(() => {
        if (!cancelled) { setFetchError('Could not find live game.'); setFetching(false) }
      })
    return () => { cancelled = true }
  }, [matchId])

  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-sm rounded-2xl flex flex-col gap-3 p-4 max-h-[90vh] overflow-y-auto"
        style={{ backgroundColor: 'var(--bg-surface)', boxShadow: 'var(--shadow-card)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
            >
              Live
            </span>
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{matchLabel}</span>
          </div>
          <button onClick={onClose} className="shrink-0 px-2 py-1 rounded text-xs"
            style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-surface-hover)' }}>
            ✕ Close
          </button>
        </div>
        {fetching && <Spinner />}
        {fetchError && <ErrorMsg>{fetchError}</ErrorMsg>}
        {slug && <SpectatorGame key={slug} slug={slug} />}
      </div>
    </div>
  )
}

// ── Admin controls ────────────────────────────────────────────────────────────

const BOT_DIFFICULTIES = [
  { value: 'novice',       label: 'Novice' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced',     label: 'Advanced' },
  { value: 'master',       label: 'Master' },
]

function AdminControls({ tournament, token, onRefresh }) {
  const [busy, setBusy]       = useState(null)
  const [err, setErr]         = useState(null)
  const [success, setSuccess] = useState(null)
  const [addBotOpen, setAddBotOpen]       = useState(false)
  const [botDifficulty, setBotDifficulty] = useState('intermediate')
  const [botName, setBotName]             = useState('')

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

  const { status, startMode } = tournament
  const participantCount  = tournament.participants?.length ?? 0
  const botCount          = (tournament.participants ?? []).filter(p => p.user?.isBot).length
  const isFull      = tournament.maxParticipants
    ? participantCount >= tournament.maxParticipants
    : botCount >= 4  // all 4 test bots already registered
  const canPublish  = status === 'DRAFT'
  const canStart    = (status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED') && startMode === 'MANUAL'
  const canCancel   = status !== 'COMPLETED' && status !== 'CANCELLED'
  const canFillBots = !isFull && (status === 'DRAFT' || status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED')

  async function fillBots() {
    if (!confirm('Fill empty slots with test bots?')) return
    setBusy('fillBots')
    setErr(null)
    setSuccess(null)
    try {
      const result = await tournamentApi.fillTestPlayers(tournament.id, token)
      setSuccess(`Added ${result.added} test bot(s).`)
      setTimeout(() => setSuccess(null), 3000)
      onRefresh()
    } catch (e) {
      setErr(e.message || 'Fill failed.')
    } finally {
      setBusy(null)
    }
  }

  async function handleAddBot() {
    setBusy('addBot')
    setErr(null)
    setSuccess(null)
    try {
      const result = await tournamentApi.addSeededBot(tournament.id, {
        difficulty: botDifficulty,
        displayName: botName.trim() || undefined,
      }, token)
      setSuccess(`Added "${result.displayName}".`)
      setBotName('')
      setAddBotOpen(false)
      setTimeout(() => setSuccess(null), 3000)
      onRefresh()
    } catch (e) {
      setErr(e.message || 'Add bot failed.')
    } finally {
      setBusy(null)
    }
  }

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
          <button
            onClick={() => act('publish', 'Publish')}
            disabled={busy === 'publish'}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-700))' }}
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
        {canFillBots && (
          <button
            onClick={fillBots}
            disabled={!!busy}
            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-emerald-500), var(--color-emerald-700))' }}
          >
            {busy === 'fillBots' ? 'Filling…' : 'Fill with test bots'}
          </button>
        )}
        {canFillBots && (
          <button
            onClick={() => setAddBotOpen(o => !o)}
            disabled={!!busy}
            className="text-xs px-3 py-1.5 rounded-lg border font-semibold transition-colors hover:bg-[var(--bg-surface-hover)] disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            + Add bot
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
      {addBotOpen && (
        <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border-default)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Add bot entrant
          </p>
          <div className="flex gap-1 flex-wrap">
            {BOT_DIFFICULTIES.map(d => (
              <button
                key={d.value}
                onClick={() => setBotDifficulty(d.value)}
                className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors"
                style={{
                  backgroundColor: botDifficulty === d.value ? 'var(--color-primary)' : 'var(--bg-surface-hover)',
                  color: botDifficulty === d.value ? 'white' : 'var(--text-secondary)',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={botName}
              onChange={e => setBotName(e.target.value)}
              placeholder={`${BOT_DIFFICULTIES.find(d => d.value === botDifficulty)?.label} Bot`}
              maxLength={40}
              className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border bg-transparent outline-none"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
              onKeyDown={e => { if (e.key === 'Enter') handleAddBot() }}
            />
            <button
              onClick={handleAddBot}
              disabled={!!busy}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-700))' }}
            >
              {busy === 'addBot' ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}
      {(status === 'REGISTRATION_OPEN' || status === 'REGISTRATION_CLOSED') && startMode !== 'MANUAL' && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {startMode === 'AUTO'
            ? 'Auto mode — will start automatically when registration closes.'
            : tournament.startTime
              ? `Scheduled — will start at ${new Date(tournament.startTime).toLocaleString()}.`
              : 'Scheduled mode — no start time set yet.'}
        </p>
      )}
      {err     && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
      {success && <p className="text-xs" style={{ color: 'var(--color-slate-600)' }}>{success}</p>}
    </div>
  )
}

// ── Registration panel ────────────────────────────────────────────────────────

const NOTIF_PREF_LABELS = {
  AS_PLAYED:         'after each match',
  END_OF_TOURNAMENT: 'when tournament ends',
}

function RegistrationPanel({ tournament, token, userId, dbUserId, onRefresh }) {
  // step: 'idle' | 'options' | 'busy'
  const [step, setStep]               = useState('idle')
  const [bots, setBots]               = useState([])
  const [participantId, setParticipantId] = useState('self')
  const [notifPref, setNotifPref]     = useState('AS_PLAYED')
  const [err, setErr]                 = useState(null)

  const needsBotPicker = tournament.mode === 'BOT_VS_BOT' || tournament.mode === 'MIXED'

  const participants    = tournament.participants ?? []
  const myParticipant   = userId ? participants.find(p => p.userId === userId) : null
  const isRegistered    = !!myParticipant && myParticipant.status !== 'WITHDRAWN'
  const participantCount = participants.filter(p => p.status !== 'WITHDRAWN').length

  async function openOptions() {
    if (needsBotPicker && bots.length === 0 && dbUserId) {
      const fetched = await fetchMyBots(token, dbUserId).catch(() => [])
      setBots(fetched)
      if (fetched.length > 0 && tournament.mode === 'BOT_VS_BOT') {
        setParticipantId(fetched[0].id)
      }
    }
    setStep('options')
  }

  async function handleRegister() {
    if (!token) return
    setStep('busy')
    setErr(null)
    try {
      const body = { resultNotifPref: notifPref }
      if (participantId !== 'self') body.participantUserId = participantId
      await tournamentApi.register(tournament.id, token, body)
      setStep('idle')
      onRefresh()
    } catch (e) {
      setErr(e.message || 'Registration failed.')
      setStep('options')
    }
  }

  async function handleWithdraw() {
    if (!token) return
    setStep('busy')
    setErr(null)
    try {
      await tournamentApi.withdraw(tournament.id, token)
      setStep('idle')
      onRefresh()
    } catch (e) {
      setErr(e.message || 'Withdrawal failed.')
      setStep('idle')
    }
  }

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Registration</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {participantCount}{tournament.maxParticipants ? `/${tournament.maxParticipants}` : ''} registered
          </p>
        </div>
        {token ? (
          isRegistered ? (
            <button
              onClick={handleWithdraw}
              disabled={step === 'busy'}
              className="text-xs px-4 py-2 rounded-lg font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--color-orange-500), var(--color-orange-700))' }}
            >
              {step === 'busy' ? 'Withdrawing…' : 'Withdraw'}
            </button>
          ) : step === 'idle' ? (
            <button
              onClick={openOptions}
              className="text-xs px-4 py-2 rounded-lg font-semibold text-white transition-all hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-700))' }}
            >
              Register
            </button>
          ) : null
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sign in to register</p>
        )}
      </div>

      {/* Already registered — show current notif pref */}
      {token && isRegistered && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Notifying: <span style={{ color: 'var(--text-secondary)' }}>
            {NOTIF_PREF_LABELS[myParticipant.resultNotifPref] ?? NOTIF_PREF_LABELS.AS_PLAYED}
          </span>
        </p>
      )}

      {/* Registration options step */}
      {token && !isRegistered && step === 'options' && (
        <div
          className="space-y-3 pt-1 border-t"
          style={{ borderColor: 'var(--border-default)' }}
        >
          {/* Who to register */}
          {needsBotPicker && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Register as:
              </p>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {tournament.mode === 'MIXED' && (
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="who-reg" value="self"
                      checked={participantId === 'self'} onChange={() => setParticipantId('self')}
                      className="accent-[var(--color-primary)]" />
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Myself (human)</span>
                  </label>
                )}
                {bots.length === 0 && (
                  <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
                    {tournament.mode === 'BOT_VS_BOT' ? 'You have no active bots.' : 'No active bots.'}
                  </p>
                )}
                {bots.map(bot => (
                  <label key={bot.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="who-reg" value={bot.id}
                      checked={participantId === bot.id} onChange={() => setParticipantId(bot.id)}
                      className="accent-[var(--color-primary)]" />
                    <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{bot.displayName}</span>
                  </label>
                ))}
              </div>
              <div className="h-px mt-2" style={{ backgroundColor: 'var(--border-default)' }} />
            </div>
          )}

          {/* Notification preference */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Notify me:
            </p>
            <div className="flex flex-col gap-1">
              {Object.entries(NOTIF_PREF_LABELS).map(([value, label]) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="notifPref" value={value}
                    checked={notifPref === value} onChange={() => setNotifPref(value)}
                    className="accent-[var(--color-primary)]" />
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {label.charAt(0).toUpperCase() + label.slice(1)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleRegister}
              disabled={tournament.mode === 'BOT_VS_BOT' && participantId === 'self' && bots.length > 0}
              className="btn-primary text-xs px-4 py-1.5 rounded-lg font-semibold text-white flex-1 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              onClick={() => { setStep('idle'); setErr(null) }}
              className="text-xs px-4 py-1.5 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)]"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
            >
              Cancel
            </button>
          </div>
        </div>
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
      // Safari Private Browsing has sessionStorage quota = 0; setItem throws.
      try { sessionStorage.setItem(`aiarena_joined_match_${matchId}`, '1') } catch {}
      onDismiss()
      navigate(`/play?join=${slug}&tournamentMatch=${matchId}&tournamentId=${tournamentId}`)
    }

    function onError({ message }) {
      cleanup()
      setJoining(false)
      const gone = message === 'Tournament match not found or already started' ||
                   message === 'Match not ready yet — please try again'
      if (gone) {
        onDismiss()
        navigate('/tournaments')
        return
      }
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
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
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
            Best of {bestOfN ?? 1} series. Play your match right here.
          </p>
        </div>
        {err && <p className="text-xs text-center" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
        <div className="flex gap-2">
          <button
            onClick={handleJoin}
            disabled={joining}
            className="flex-1 px-4 py-2 rounded-lg font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-700))' }}
          >
            {joining ? 'Joining…' : 'Join Match'}
          </button>
          <button
            onClick={onDismiss}
            disabled={joining}
            className="px-4 py-2 rounded-lg border text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Persistent inline match-ready card (HvH) ─────────────────────────────────
// Always visible in the page body when the current user has a pending HvH match.
// Complements the overlay banner so players always have a way to join even after
// dismissing the popup or hard-reloading the page.

function HvhMatchReadyCard({ matchData, token }) {
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)
  const [err, setErr]         = useState(null)

  const { matchId, bestOfN, opponentName } = matchData

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
      // Safari Private Browsing has sessionStorage quota = 0; setItem throws.
      try { sessionStorage.setItem(`aiarena_joined_match_${matchId}`, '1') } catch {}
      navigate(`/play?join=${slug}&tournamentMatch=${matchId}&tournamentId=${tournamentId}`)
    }
    function onError({ message }) {
      cleanup()
      setJoining(false)
      setErr(message || 'Failed to join match room')
    }

    socket.once('tournament:room:ready', onReady)
    socket.once('error', onError)
    getToken().then(authToken => socket.emit('tournament:room:join', { matchId, authToken }))
  }

  return (
    <div
      className="rounded-xl border p-4 flex items-center justify-between gap-4"
      style={{ backgroundColor: 'var(--color-blue-50)', borderColor: 'var(--color-blue-200)' }}
    >
      <div className="space-y-0.5 min-w-0">
        <p className="text-sm font-bold" style={{ color: 'var(--color-blue-800)' }}>
          Your match is ready!
        </p>
        <p className="text-xs truncate" style={{ color: 'var(--color-blue-600)' }}>
          vs {opponentName} · Best of {bestOfN}
        </p>
        {err && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{err}</p>}
      </div>
      <button
        onClick={handleJoin}
        disabled={joining}
        className="shrink-0 px-5 py-2 rounded-lg font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
      >
        {joining ? 'Joining…' : 'Join Match'}
      </button>
    </div>
  )
}

// ── Persistent inline match-ready card (Mixed) ───────────────────────────────
// Always visible in the page body when the current user has a pending MIXED match.
// Complements the overlay banner so players always have a way to play.

function MixedMatchReadyCard({ matchData, tournament }) {
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)
  const [joinErr, setJoinErr] = useState(null)
  const { matchId, opponentName, opponentBetterAuthId, isOpponentBot, bestOfN } = matchData

  function markJoined() {
    // Safari Private Browsing has sessionStorage quota = 0; setItem throws.
    try { sessionStorage.setItem(`aiarena_joined_match_${matchId}`, '1') } catch {}
  }

  function playVsBot() {
    if (!opponentBetterAuthId) return
    markJoined()
    const params = new URLSearchParams({
      botUserId: opponentBetterAuthId,
      tournamentMatch: matchId,
      tournamentId: tournament.id,
    })
    navigate(`/play?${params.toString()}`)
  }

  // MIXED mode can pair two humans just like HVH. When the opponent is human
  // we must use the shared HvH room flow (tournament:room:join) — otherwise
  // BOTH players would navigate into separate HvB rooms where each treats
  // the other as a bot and the games never connect.
  function playVsHuman() {
    setJoining(true)
    setJoinErr(null)
    const socket = connectSocket()
    function cleanup() {
      socket.off('tournament:room:ready', onReady)
      socket.off('error', onError)
    }
    function onReady({ slug, tournamentId }) {
      cleanup()
      markJoined()
      navigate(`/play?join=${slug}&tournamentMatch=${matchId}&tournamentId=${tournamentId}`)
    }
    function onError({ message }) {
      cleanup()
      setJoining(false)
      setJoinErr(message || 'Failed to join match room')
    }
    socket.once('tournament:room:ready', onReady)
    socket.once('error', onError)
    getToken().then(authToken => socket.emit('tournament:room:join', { matchId, authToken }))
  }

  const handlePlay = isOpponentBot ? playVsBot : playVsHuman
  const disabled = isOpponentBot ? !opponentBetterAuthId : joining

  return (
    <div
      className="rounded-xl border p-4 flex items-center justify-between gap-4"
      style={{ backgroundColor: 'var(--color-blue-50)', borderColor: 'var(--color-blue-200)' }}
    >
      <div className="space-y-0.5 min-w-0">
        <p className="text-sm font-bold" style={{ color: 'var(--color-blue-800)' }}>Your match is ready!</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-blue-600)' }}>
          vs {opponentName} · Best of {bestOfN}
        </p>
        {joinErr && <p className="text-xs" style={{ color: 'var(--color-red-600)' }}>{joinErr}</p>}
      </div>
      <button
        onClick={handlePlay}
        disabled={disabled}
        className="shrink-0 px-5 py-2 rounded-lg font-semibold text-sm text-white transition-all hover:brightness-110 disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
      >
        {joining ? 'Joining…' : 'Play Match'}
      </button>
    </div>
  )
}

// ── Mixed match banner ────────────────────────────────────────────────────────

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function checkWinnerWithLine(cells) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return { mark: cells[a], line }
  }
  if (cells.every(Boolean)) return { mark: 'DRAW', line: null }
  return null
}

function MixedMatchBoard({ matchId, tournament, userId, token, onDone }) {
  const playSound = useSoundStore(s => s.play)
  const participants = tournament.participants ?? []
  const myParticipant = participants.find(p => p.userId === userId)
  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.seedPosition != null && b.seedPosition != null) return a.seedPosition - b.seedPosition
    return a.id < b.id ? -1 : 1
  })
  const myMark  = myParticipant ? (sortedParticipants[0]?.id === myParticipant.id ? 'X' : 'O') : 'X'
  const botMark = myMark === 'X' ? 'O' : 'X'

  const myDisplayName  = myParticipant?.user?.displayName ?? 'You'
  const botParticipant = sortedParticipants.find(p => p.id !== myParticipant?.id)
  const botDisplayName = botParticipant?.user?.displayName ?? 'Bot'
  const myElo  = myParticipant?.eloAtRegistration ? Math.round(myParticipant.eloAtRegistration) : null
  const botElo = botParticipant?.eloAtRegistration ? Math.round(botParticipant.eloAtRegistration) : null

  const [cells, setCells]           = useState(Array(9).fill(null))
  const [current, setCurrent]       = useState('X')
  const [outcome, setOutcome]       = useState(null)     // 'X' | 'O' | 'DRAW' | null
  const [winLine, setWinLine]       = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitErr, setSubmitErr]   = useState(null)

  useEffect(() => {
    if (outcome || current !== botMark) return
    const timer = setTimeout(() => {
      setCells(prev => {
        const empty = prev.map((v, i) => v === null ? i : null).filter(i => i !== null)
        if (empty.length === 0) return prev
        const pick = empty[Math.floor(Math.random() * empty.length)]
        const next = [...prev]
        next[pick] = botMark
        playSound('move')
        const result = checkWinnerWithLine(next)
        if (result) {
          setWinLine(result.line)
          setOutcome(result.mark)
        } else {
          setCurrent(myMark)
        }
        return next
      })
    }, 500)
    return () => clearTimeout(timer)
  }, [current, outcome, botMark, myMark, playSound])

  // Play win/draw sound when the game ends.
  useEffect(() => {
    if (!outcome) return
    if (outcome === 'DRAW') playSound('draw')
    else if (outcome === myMark) playSound('win')
    else playSound('forfeit')
  }, [outcome, myMark, playSound])

  function handleCellClick(idx) {
    if (outcome || cells[idx] || current !== myMark) return
    const next = [...cells]
    next[idx] = myMark
    playSound('move')
    const result = checkWinnerWithLine(next)
    setCells(next)
    if (result) {
      setWinLine(result.line)
      setOutcome(result.mark)
    } else {
      setCurrent(botMark)
    }
  }

  useEffect(() => {
    if (!outcome || submitting) return
    async function submit() {
      setSubmitting(true)
      setSubmitErr(null)
      let p1Id = null, p2Id = null
      for (const round of (tournament.rounds ?? [])) {
        for (const match of (round.matches ?? [])) {
          if (match.id === matchId) { p1Id = match.participant1Id; p2Id = match.participant2Id; break }
        }
        if (p1Id) break
      }
      if (!p1Id) { p1Id = sortedParticipants[0]?.id ?? null; p2Id = sortedParticipants[1]?.id ?? null }
      const myParticipantId = myParticipant?.id ?? null
      const opponentParticipantId = myParticipantId === p1Id ? p2Id : p1Id
      let winnerId = null, p1Wins = 0, p2Wins = 0, drawGames = 0
      if (outcome === 'DRAW') {
        drawGames = 1
      } else {
        winnerId = outcome === myMark ? myParticipantId : opponentParticipantId
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

  const statusText = submitting ? 'Submitting result…'
    : outcome === 'DRAW' ? "It's a draw!"
    : outcome === myMark ? 'You win!'
    : outcome ? `${botDisplayName} wins!`
    : current === myMark ? 'Your turn'
    : `${botDisplayName} is thinking…`

  return (
    <div className="space-y-4">
      {/* Player strips — mirrors XOGame layout */}
      <div className="flex items-stretch gap-2">
        <PlayerStrip
          mark={myMark}
          name={myDisplayName}
          elo={myElo}
          active={!outcome && current === myMark}
        />
        <div className="flex items-center px-2 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>vs</div>
        <PlayerStrip
          mark={botMark}
          name={botDisplayName}
          elo={botElo}
          active={!outcome && current === botMark}
        />
      </div>

      <p className="text-sm font-semibold text-center" style={{ color: 'var(--text-primary)' }}>{statusText}</p>

      <div className="grid mx-auto" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', maxWidth: '360px' }}>
        {cells.map((cell, idx) => {
          const isClickable  = !outcome && !cell && current === myMark
          const isWinCell    = winLine?.includes(idx)
          return (
            <button
              key={idx}
              onClick={() => handleCellClick(idx)}
              disabled={!isClickable}
              className="flex items-center justify-center rounded-xl border-2 font-bold transition-all"
              style={{
                aspectRatio: '1',
                fontSize: '2.5rem',
                borderColor: isWinCell ? 'var(--color-primary)' : 'var(--border-default)',
                backgroundColor: isWinCell
                  ? 'var(--color-amber-50)'
                  : cell
                    ? (cell === 'X' ? 'var(--color-slate-50)' : 'var(--color-orange-50)')
                    : 'var(--bg-surface)',
                color: cell === 'X' ? 'var(--color-slate-700)' : 'var(--color-orange-500)',
                cursor: isClickable ? 'pointer' : 'default',
                boxShadow: isWinCell ? 'var(--shadow-card)' : (isClickable ? 'var(--shadow-card)' : 'none'),
                transform: isWinCell ? 'scale(1.02)' : 'none',
                opacity: outcome && !cell ? 0.4 : 1,
              }}
            >
              {cell ?? ''}
            </button>
          )
        })}
      </div>

      {submitErr && <p className="text-xs text-center" style={{ color: 'var(--color-red-600)' }}>{submitErr}</p>}
    </div>
  )
}

function PlayerStrip({ mark, name, elo, active }) {
  const markColor = mark === 'X' ? 'var(--color-slate-700)' : 'var(--color-orange-500)'
  const markBg    = mark === 'X' ? 'var(--color-slate-100)' : 'var(--color-orange-50)'
  return (
    <div
      className="flex-1 flex items-center gap-3 rounded-lg border px-3 py-2 transition-all"
      style={{
        borderColor: active ? 'var(--color-primary)' : 'var(--border-default)',
        backgroundColor: 'var(--bg-surface)',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-xl shrink-0"
        style={{ backgroundColor: markBg, color: markColor }}
      >
        {mark}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{name}</div>
        {elo != null && (
          <div className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>ELO {elo}</div>
        )}
      </div>
    </div>
  )
}

function MixedMatchBanner({ tournament, userId, matchEvent, onDismiss }) {
  const navigate = useNavigate()
  if (!matchEvent || tournament.mode !== 'MIXED') return null
  const { matchId, participant1UserId, participant2UserId } = matchEvent
  const isParticipant = userId && (userId === participant1UserId || userId === participant2UserId)
  if (!isParticipant) return null

  // Resolve opponent's betterAuthId from the current tournament snapshot.
  const participants = tournament.participants ?? []
  const me = participants.find(p => p.user?.id === userId || p.userId === userId)
  const match = (tournament.rounds ?? []).flatMap(r => r.matches ?? []).find(m => m.id === matchId)
  const opponentId = match?.participant1Id === me?.id ? match?.participant2Id : match?.participant1Id
  const opponent = participants.find(p => p.id === opponentId)
  // Seeded bots have no betterAuthId — fall back to User.id.
  const opponentBetterAuthId = opponent?.user?.betterAuthId ?? opponent?.user?.id ?? null
  const opponentName         = opponent?.user?.displayName ?? 'Opponent'
  const isOpponentBot        = !!opponent?.user?.isBot

  function playVsBot() {
    if (!opponentBetterAuthId) return
    try { sessionStorage.setItem(`aiarena_joined_match_${matchId}`, '1') } catch {}
    const params = new URLSearchParams({
      botUserId: opponentBetterAuthId,
      tournamentMatch: matchId,
      tournamentId: tournament.id,
    })
    onDismiss?.()
    navigate(`/play?${params.toString()}`)
  }

  // MIXED mode can pair two humans — route them through the HvH room flow
  // so both land in the same room instead of independent HvB games.
  function playVsHuman() {
    const socket = connectSocket()
    function cleanup() {
      socket.off('tournament:room:ready', onReady)
      socket.off('error', onError)
    }
    function onReady({ slug, tournamentId }) {
      cleanup()
      try { sessionStorage.setItem(`aiarena_joined_match_${matchId}`, '1') } catch {}
      onDismiss?.()
      navigate(`/play?join=${slug}&tournamentMatch=${matchId}&tournamentId=${tournamentId}`)
    }
    function onError() { cleanup() }
    socket.once('tournament:room:ready', onReady)
    socket.once('error', onError)
    getToken().then(authToken => socket.emit('tournament:room:join', { matchId, authToken }))
  }

  const handlePlay = isOpponentBot ? playVsBot : playVsHuman

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-6 space-y-4"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="space-y-1 text-center">
          <div
            className="inline-block text-[10px] font-bold uppercase tracking-widest px-3 py-0.5 rounded-full mb-1"
            style={{ backgroundColor: 'var(--color-blue-50)', color: 'var(--color-blue-700)' }}
          >
            Match Ready
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Play vs {opponentName}
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Best of {tournament.bestOfN ?? 3}. Result is submitted automatically.
          </p>
        </div>
        <div className="flex gap-2 justify-center">
          <button
            onClick={onDismiss}
            className="px-4 py-2 rounded-lg text-sm font-semibold border"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Later
          </button>
          <button
            onClick={handlePlay}
            disabled={!opponentBetterAuthId}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))' }}
          >
            Play Match
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Final standings ───────────────────────────────────────────────────────────

function computeStandings(tournament) {
  const { participants } = tournament
  const active = (participants ?? []).filter(p => p.status !== 'WITHDRAWN')
  if (active.length === 0) return []

  // The backend sets finalPosition on each participant when the tournament completes.
  // Use it directly — it's authoritative and handles all bracket types correctly.
  const withPos = active.filter(p => p.finalPosition != null)
  if (withPos.length > 0) {
    const sorted = [...withPos].sort((a, b) => a.finalPosition - b.finalPosition)
    const unranked = active.filter(p => p.finalPosition == null)
    return [
      ...sorted.map(p => ({ ...p, position: p.finalPosition })),
      ...unranked.map(p => ({ ...p, position: null })),
    ]
  }

  return []
}

function posLabel(n) {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

const PODIUM = {
  1: { medal: '🥇', rowBg: 'rgba(251,191,36,0.10)', accent: '#f59e0b', nameColor: '#92400e' },
  2: { medal: '🥈', rowBg: 'rgba(148,163,184,0.12)', accent: '#94a3b8', nameColor: 'var(--text-primary)' },
  3: { medal: '🥉', rowBg: 'rgba(180,83,9,0.08)',   accent: '#b45309', nameColor: '#7c2d12' },
}

function FinalStandings({ tournament }) {
  const standings = computeStandings(tournament)
  if (standings.length === 0) {
    return <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No standings data available.</p>
  }

  return (
    <div className="rounded-xl border overflow-hidden divide-y"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
    >
      {standings.map(s => {
        const podium = s.position != null ? PODIUM[s.position] : null
        return (
          <div key={s.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{
              backgroundColor: podium?.rowBg,
              borderLeft: podium ? `3px solid ${podium.accent}` : '3px solid transparent',
            }}
          >
            <span className="text-xl leading-none w-8 text-center shrink-0">
              {podium
                ? podium.medal
                : <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-muted)' }}>{s.position != null ? posLabel(s.position) : '—'}</span>
              }
            </span>
            <PlayerLink
              userId={s.user?.id}
              className={`text-sm flex-1 ${podium ? 'font-bold' : 'font-medium'}`}
              style={{ color: podium?.nameColor ?? 'var(--text-primary)' }}
            >
              {s.user?.displayName ?? `Participant ${s.id?.slice(0, 6)}`}
            </PlayerLink>
            {s.position === 1 && (
              <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: 'rgba(251,191,36,0.2)', color: '#92400e' }}>
                Champion
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Participants table ────────────────────────────────────────────────────────

function ParticipantTable({ participants }) {
  if (!participants || participants.length === 0) {
    return <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>No participants yet.</p>
  }

  const sorted = [...participants].sort((a, b) => (a.seedPosition ?? 999) - (b.seedPosition ?? 999))

  return (
    <ListTable>
      <thead>
        <tr>
          <ListTh>Seed</ListTh>
          <ListTh>Player</ListTh>
          <ListTh>ELO</ListTh>
          <ListTh>Status</ListTh>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p, i) => (
          <ListTr
            key={p.id}
            last={i === sorted.length - 1}
            dimmed={p.status === 'WITHDRAWN' || p.status === 'ELIMINATED'}
          >
            <ListTd className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {p.seedPosition ?? '—'}
            </ListTd>
            <ListTd>
              <PlayerLink
                userId={p.user?.id}
                className="text-sm font-medium"
                style={{ color: 'var(--text-primary)' }}
              >
                {p.user?.displayName ?? `User ${p.userId.slice(0, 6)}`}
              </PlayerLink>
              {p.finalPosition && (
                <span className="ml-2 text-[10px] font-bold" style={{ color: 'var(--color-amber-600)' }}>
                  #{p.finalPosition}
                </span>
              )}
            </ListTd>
            <ListTd className="text-xs tabular-nums font-mono" style={{ color: 'var(--color-blue-600)' }}>
              {p.eloAtRegistration ? Math.round(p.eloAtRegistration) : '—'}
            </ListTd>
            <ListTd>
              <StatusBadge status={p.status} styles={PARTICIPANT_STATUS_STYLES} />
            </ListTd>
          </ListTr>
        ))}
      </tbody>
    </ListTable>
  )
}

function Section({ title, children }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
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
  const [tournament, setTournament] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)
  const [token, setToken]           = useState(undefined) // undefined = resolving; null = unauthenticated; string = token
  const [dbUserId, setDbUserId]     = useState(null)
  const [activeMatchEvent, setActiveMatchEvent] = useState(null)
  const [replayMatch, setReplayMatch]           = useState(null) // { id, label }
  const [watchMatch, setWatchMatch]             = useState(null) // { id, label }
  // Tracks whether we have successfully loaded tournament data at least once.
  // Used to skip the loading spinner on silent re-fetches (e.g. after auth resolves).
  const tournamentRef = useRef(null)
  // Tracks match IDs for which the overlay was dismissed ("Later") so the synthesis
  // doesn't immediately re-show it. Cleared when the match changes (next round).
  const dismissedOverlayMatchRef = useRef(null)

  const isAdmin          = session?.user?.role === 'admin'
  const userId           = session?.user?.id ?? null
  const userBetterAuthId = session?.user?.id ?? null

  useEffect(() => {
    if (!session?.user?.id) { setToken(null); setDbUserId(null); return }
    getToken().then(async t => {
      setToken(t)
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

  // Reset cached data when navigating to a different tournament.
  useEffect(() => { tournamentRef.current = null }, [id])

  const load = useCallback(async () => {
    // If a session user is known but the token hasn't resolved yet, skip the pre-fetch.
    // Doing it unauthenticated would 404 on DRAFT tournaments (console noise).
    // The warm-cached /api/token response arrives in ~100ms so the delay is minimal.
    if (token === undefined && session?.user?.id) return

    // For unauthenticated visitors (token stays undefined with no session user),
    // treat undefined as null so public tournaments render immediately.
    const effectiveToken = token === undefined ? null : token
    if (!tournamentRef.current) { setLoading(true); setError(null) }
    try {
      const data = await tournamentApi.get(id, effectiveToken)
      tournamentRef.current = data.tournament ?? data
      setTournament(tournamentRef.current)
      setLoading(false)
    } catch (e) {
      if (!tournamentRef.current && token !== undefined) {
        // Auth is settled and we still have no data — surface the error.
        setError(e.message || 'Failed to load tournament.')
        setLoading(false)
      }
      // token === undefined: auth pending — keep spinner, retry when token resolves
      // tournamentRef.current set: silent re-auth re-fetch failed — keep existing data
    }
  }, [id, token, session?.user?.id])

  useEffect(() => { load() }, [load])

  // ── Tier 2 SSE subscription ────────────────────────────────────────────────
  // Any tournament:* SSE event for this tournament triggers a REST refetch.
  // This is the authoritative "something changed on this tournament" signal.
  useEventStream({
    channels: ['tournament:'],
    onEvent: (channel, payload) => {
      if (payload?.tournamentId !== id) return
      if (channel === 'tournament:match:ready') setActiveMatchEvent(payload)
      load()
    },
  })

  // ── Backstop polling while the page is visible and the tournament is active ──
  // Catches events that slipped past SSE — e.g. during a backend restart
  // between event fire and any client being connected. Paused on hidden tabs.
  useEffect(() => {
    if (!tournament) return
    // Poll only while the tournament is in an actively-changing state.
    const activeStatuses = ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'IN_PROGRESS']
    if (!activeStatuses.includes(tournament.status)) return

    let cancelled = false
    const tick = () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.hidden) return
      load()
    }
    const timer = setInterval(tick, 20_000)
    // Refetch immediately on tab-become-visible so users who switched away
    // for a while get up-to-date state on return.
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [tournament?.status, load]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive pending match for the current user from tournament data.
  // Used for both the overlay synthesis and the persistent inline card.
  // Falls back to dbUserId if betterAuthId isn't populated in participant data.
  const myPendingHvhMatch = React.useMemo(() => {
    if (!tournament || tournament.status !== 'IN_PROGRESS' || tournament.mode !== 'HVH') return null
    if (!userBetterAuthId && !dbUserId) return null

    const myParticipant = (tournament.participants ?? []).find(p =>
      (userBetterAuthId && p.user?.betterAuthId === userBetterAuthId) ||
      (dbUserId && p.user?.id === dbUserId)
    )
    if (!myParticipant) return null

    const match = (tournament.rounds ?? [])
      .flatMap(r => r.matches ?? [])
      .find(m => m.status === 'PENDING' &&
        (m.participant1Id === myParticipant.id || m.participant2Id === myParticipant.id))
    if (!match) return null

    const opponentId = match.participant1Id === myParticipant.id
      ? match.participant2Id : match.participant1Id
    const opponent = (tournament.participants ?? []).find(p => p.id === opponentId)

    return {
      tournamentId: tournament.id,
      matchId: match.id,
      bestOfN: tournament.bestOfN ?? 1,
      participant1UserId: myParticipant.user?.betterAuthId,
      participant2UserId: opponent?.user?.betterAuthId,
      opponentName: opponent?.user?.displayName ?? 'Opponent',
    }
  }, [tournament, userBetterAuthId, dbUserId])

  // Derive pending MIXED match (human vs bot) that the current user needs to play inline.
  const myPendingMixedMatch = React.useMemo(() => {
    if (!tournament || tournament.status !== 'IN_PROGRESS' || tournament.mode !== 'MIXED') return null
    if (!dbUserId && !userId) return null

    const myParticipant = (tournament.participants ?? []).find(p =>
      (dbUserId && p.user?.id === dbUserId) ||
      (userId && p.userId === userId)
    )
    if (!myParticipant || myParticipant.user?.isBot) return null

    const match = (tournament.rounds ?? [])
      .flatMap(r => r.matches ?? [])
      .find(m => m.status === 'PENDING' && m.participant1Id && m.participant2Id &&
        (m.participant1Id === myParticipant.id || m.participant2Id === myParticipant.id))
    if (!match) return null

    const opponentId = match.participant1Id === myParticipant.id
      ? match.participant2Id : match.participant1Id
    const opponent = (tournament.participants ?? []).find(p => p.id === opponentId)

    return {
      matchId: match.id,
      opponentName: opponent?.user?.displayName ?? 'Opponent',
      // Seeded bots have no betterAuthId — fall back to User.id. Backend
      // resolves both when joining the HvB room.
      opponentBetterAuthId: opponent?.user?.betterAuthId ?? opponent?.user?.id ?? null,
      isOpponentBot: !!opponent?.user?.isBot,
      bestOfN: tournament.bestOfN ?? 3,
    }
  }, [tournament, dbUserId, userId])

  // Synthesize activeMatchEvent from tournament data (for overlay) when not already set.
  // Skips if the user dismissed this overlay ("Later") or has already joined the match.
  useEffect(() => {
    if (!myPendingHvhMatch) return
    if (activeMatchEvent) return
    if (dismissedOverlayMatchRef.current === myPendingHvhMatch.matchId) return
    if (sessionStorage.getItem(`aiarena_joined_match_${myPendingHvhMatch.matchId}`)) return
    setActiveMatchEvent(myPendingHvhMatch)
  }, [myPendingHvhMatch, activeMatchEvent])

  // Poll every 10s while in progress — match:result events are per-participant
  // only, so viewers (including admins) don't receive them via socket.
  useEffect(() => {
    if (tournament?.status !== 'IN_PROGRESS') return
    const timer = setInterval(load, 10_000)
    return () => clearInterval(timer)
  }, [tournament?.status, load])

  // "Back to Tournaments" routes to wherever the user came from, captured in
  // the navigation state when the link was clicked. Admins who browse via
  // /admin/tournaments end up back there; everyone else (and direct-link /
  // refreshed navigations where state was lost) defaults to the public list.
  const location = useLocation()
  const backTo = location.state?.from === '/admin/tournaments'
    ? '/admin/tournaments'
    : '/tournaments'

  if (loading) return <div className="max-w-4xl mx-auto px-4 py-8"><Spinner /></div>
  if (error) return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
      <Link to={backTo} className="text-sm" style={{ color: 'var(--color-primary)' }}>← Back to Tournaments</Link>
      <ErrorMsg>{error}</ErrorMsg>
    </div>
  )
  if (!tournament) return null

  const t = tournament

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {tournament && activeMatchEvent && (
        <PvpMatchBanner
          tournament={tournament}
          userBetterAuthId={userBetterAuthId}
          token={token}
          matchEvent={activeMatchEvent}
          onDismiss={() => {
            dismissedOverlayMatchRef.current = activeMatchEvent?.matchId ?? null
            setActiveMatchEvent(null)
          }}
        />
      )}
      {tournament && activeMatchEvent && (
        <MixedMatchBanner
          tournament={tournament}
          userId={userId}
          token={token}
          matchEvent={activeMatchEvent}
          onDismiss={() => { setActiveMatchEvent(null); load() }}
        />
      )}

      <Link to={backTo} className="text-sm" style={{ color: 'var(--color-primary)' }}>
        ← Tournaments
      </Link>

      <div className="pb-4 border-b space-y-2" style={{ borderColor: 'var(--border-default)' }}>
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
              {t.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <StatusBadge status={t.status} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t.game?.toUpperCase()} · {t.mode} · {t.format} · {t.bracketType?.replace('_', ' ')}
              </span>
              {t.bestOfN && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Best of {t.bestOfN}</span>}
            </div>
          </div>
        </div>
        {t.description && <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{t.description}</p>}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {t.startTime && <span>Start: {new Date(t.startTime).toLocaleString()}</span>}
          {t.registrationOpenAt && <span>Reg opens: {new Date(t.registrationOpenAt).toLocaleString()}</span>}
          {t.registrationCloseAt && <span>Reg closes: {new Date(t.registrationCloseAt).toLocaleString()}</span>}
        </div>
      </div>

      {isAdmin && token && <AdminControls tournament={t} token={token} onRefresh={load} />}

      {myPendingHvhMatch && <HvhMatchReadyCard matchData={myPendingHvhMatch} token={token} />}
      {myPendingMixedMatch && (
        <MixedMatchReadyCard
          matchData={myPendingMixedMatch}
          tournament={tournament}
          userId={dbUserId ?? userId}
          token={token}
          onDone={load}
        />
      )}

      {t.status === 'REGISTRATION_OPEN' && (!t.registrationCloseAt || new Date(t.registrationCloseAt) > new Date()) && (
        <Section title="Registration">
          <RegistrationPanel tournament={t} token={token} userId={dbUserId ?? userId} dbUserId={dbUserId} onRefresh={load} />
        </Section>
      )}

      {t.status === 'COMPLETED' && (
        <Section title="Final Standings">
          <FinalStandings tournament={t} />
        </Section>
      )}

      {(t.rounds?.length > 0 || t.status === 'IN_PROGRESS' || t.status === 'COMPLETED') && (
        <Section title="Bracket">
          <div
            className="rounded-xl border p-4"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}
          >
            <TournamentBracket rounds={t.rounds ?? []} participants={t.participants ?? []}
              onMatchClick={(id, label) => setReplayMatch({ id, label })}
              onMatchSpectate={(id, label) => setWatchMatch({ id, label })} />
          </div>
        </Section>
      )}

      <Section title={`Participants (${(t.participants ?? []).length})`}>
        <ParticipantTable participants={t.participants ?? []} />
      </Section>

      {replayMatch && (
        <MatchReplayModal
          matchId={replayMatch.id}
          matchLabel={replayMatch.label}
          onClose={() => setReplayMatch(null)}
        />
      )}
      {watchMatch && (
        <MatchSpectateModal
          matchId={watchMatch.id}
          matchLabel={watchMatch.label}
          onClose={() => setWatchMatch(null)}
        />
      )}
    </div>
  )
}
