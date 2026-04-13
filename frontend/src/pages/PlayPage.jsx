// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState, useRef } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useGameStore } from '../store/gameStore.js'
import { usePvpStore } from '../store/pvpStore.js'
import { cachedFetch } from '../lib/api.js'
import ModeSelection from '../components/game/ModeSelection.jsx'
import GameBoard from '../components/game/GameBoard.jsx'
import RoomLobby from '../components/room/RoomLobby.jsx'
import PvPBoard from '../components/room/PvPBoard.jsx'
import IdleWarningPopup from '../components/pvp/IdleWarningPopup.jsx'
import { getSocket } from '../lib/socket.js'

export default function PlayPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const joinSlug = searchParams.get('join')
  const spectateSlug = searchParams.get('spectate')
  const actionParam = searchParams.get('action')
  const tournamentMatchId = searchParams.get('tournamentMatch')
  const tournamentId = searchParams.get('tournamentId')
  const isTournamentMatch = !!tournamentMatchId

  const [seriesResult, setSeriesResult] = useState(null)  // set when tournament:series:complete fires

  const { status: pvaiStatus, mode: pvaiMode } = useGameStore()
  const {
    status: pvpStatus, joinRoom, role, slug, isAutoRoom, displayName,
    abandoned, kicked, myMark, reset, error: pvpError,
  } = usePvpStore()

  const inviteUrl = slug ? `${window.location.origin}/play?join=${slug}` : ''

  // Warm the bot cache in the background so "Challenge a Bot" opens instantly.
  useEffect(() => { cachedFetch('/bots', 5 * 60_000).refresh.catch(() => {}) }, [])

  // Prefetch Gym chunks during idle time so navigating Play → Gym is instant.
  // Importing TrainTab also pulls in the recharts vendor-charts chunk as a dep.
  useEffect(() => {
    const fire = () => {
      import('../components/gym/gymShared.jsx').catch(() => {})
      import('../components/gym/TrainTab.jsx').catch(() => {})
    }
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(fire)
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(fire, 2000)
    return () => clearTimeout(id)
  }, [])

  // Listen for tournament series completion
  useEffect(() => {
    if (!isTournamentMatch) return
    const socket = getSocket()
    if (!socket) return

    function onSeriesComplete(data) {
      if (data.matchId === tournamentMatchId) {
        setSeriesResult(data)
      }
    }

    socket.on('tournament:series:complete', onSeriesComplete)
    return () => socket.off('tournament:series:complete', onSeriesComplete)
  }, [isTournamentMatch, tournamentMatchId])

  // Auto-create a room on arrival (unless joining or spectating via link)
  useEffect(() => {
    if (spectateSlug) {
      if (pvpStatus === 'idle') joinRoom(spectateSlug, 'spectator')
    } else if (joinSlug) {
      if (pvpStatus === 'idle') joinRoom(joinSlug, 'player')
    } else if (pvpStatus === 'idle') {
      usePvpStore.getState().createRoom({ auto: true })
    }
  }, [pvpStatus])

  // Room abandoned (idle) — navigate to lobby after brief notification
  useEffect(() => {
    if (!abandoned) return
    const id = setTimeout(() => {
      reset()
      navigate(isTournamentMatch ? `/tournaments/${tournamentId}` : '/play', { replace: true })
    }, 3000)
    return () => clearTimeout(id)
  }, [abandoned])

  // Kicked (spectator idle) — navigate away immediately
  useEffect(() => {
    if (!kicked) return
    reset()
    navigate('/play', { replace: true })
  }, [kicked])

  // Tournament series complete screen
  if (seriesResult) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 max-w-sm mx-auto text-center">
        <div className="text-5xl">🏆</div>
        <div>
          <p className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            Series Complete
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {seriesResult.p1Wins} – {seriesResult.p2Wins}
          </p>
        </div>
        <Link
          to={`/tournaments/${tournamentId}`}
          className="btn btn-primary"
          onClick={() => { reset(); setSeriesResult(null) }}
        >
          Back to Tournament
        </Link>
      </div>
    )
  }

  // PvP flow — only show RoomLobby for manually created rooms (not tournament rooms)
  if (pvpStatus === 'waiting' && role === 'host' && !isAutoRoom && !isTournamentMatch) return <RoomLobby />
  if (pvpStatus === 'waiting' && (role === 'guest' || (role === 'host' && isTournamentMatch))) return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      <p style={{ color: 'var(--text-secondary)' }}>
        {isTournamentMatch ? 'Waiting for opponent…' : 'Joining room…'}
      </p>
    </div>
  )
  if (pvpStatus === 'waiting' && role === 'spectator') return (
    <div className="flex flex-col items-center gap-4 py-12">
      {pvpError ? (
        <>
          <div className="text-4xl">📭</div>
          <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {pvpError === 'Room not found' ? 'This game has already ended.' : pvpError}
          </p>
          <button onClick={reset} className="btn btn-primary text-sm">Back to Play</button>
        </>
      ) : (
        <>
          <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
          <p style={{ color: 'var(--text-secondary)' }}>Joining as spectator…</p>
        </>
      )}
    </div>
  )

  if (pvpStatus === 'playing' || pvpStatus === 'finished') {
    // Room abandoned — show the message overlay instead of the board
    if (abandoned) {
      return (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="text-4xl">💤</div>
          <p className="text-lg font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
            Room ended due to inactivity
          </p>
          <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
            No result recorded. Returning…
          </p>
        </div>
      )
    }

    return (
      <>
        <div className="flex flex-col items-center w-full max-w-md mx-auto">
          <PvPBoard isTournamentMatch={isTournamentMatch} />
        </div>
        <IdleWarningPopup />
      </>
    )
  }

  // HvA / AI-vs-AI flow
  const inGame = pvaiStatus !== 'idle' && (pvaiMode === 'hva' || pvaiMode === 'aivai')
  if (inGame) return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto gap-4">
      <GameBoard roomName={displayName} />
      <InviteBar inviteUrl={inviteUrl} />
    </div>
  )

  return (
    <div className="flex flex-col items-center w-full max-w-md mx-auto">
      <ModeSelection
        inviteUrl={inviteUrl}
        roomName={displayName}
        onPvpJoin={(s) => usePvpStore.getState().joinRoom(s, 'player')}
        autoAction={actionParam}
      />
    </div>
  )
}

function InviteBar({ inviteUrl }) {
  const [copied, setCopied] = useState(false)
  if (!inviteUrl) return null
  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }
  return (
    <button
      onClick={handleCopy}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-colors hover:bg-[var(--bg-surface-hover)]"
      style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
    >
      <span style={{ color: 'var(--text-muted)' }}>👥</span>
      <span className="flex-1 text-left truncate font-mono" style={{ color: 'var(--text-muted)' }}>{inviteUrl}</span>
      <span className="font-semibold shrink-0" style={{ color: copied ? 'var(--color-teal-600)' : 'var(--color-blue-600)' }}>
        {copied ? '✓ Copied' : 'Invite'}
      </span>
    </button>
  )
}
