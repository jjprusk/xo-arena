import React, { useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link, Navigate } from 'react-router-dom'
import { usePvpStore, PvPBoard, IdleWarningPopup } from '@xo-arena/xo'
import { getSocket } from '../lib/socket.js'

export default function PlayPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const joinSlug        = searchParams.get('join')
  const tournamentMatchId = searchParams.get('tournamentMatch')
  const tournamentId    = searchParams.get('tournamentId')
  const isTournamentMatch = !!tournamentMatchId

  const [seriesResult, setSeriesResult] = useState(null)

  const { status, joinRoom, abandoned, kicked, reset } = usePvpStore()

  // Auto-join the room from URL params
  useEffect(() => {
    if (joinSlug && status === 'idle') {
      joinRoom(joinSlug, 'player')
    }
  }, [status])

  // Listen for tournament series completion
  useEffect(() => {
    if (!isTournamentMatch) return
    const socket = getSocket()
    function onSeriesComplete(data) {
      if (data.matchId === tournamentMatchId) setSeriesResult(data)
    }
    socket.on('tournament:series:complete', onSeriesComplete)
    return () => socket.off('tournament:series:complete', onSeriesComplete)
  }, [isTournamentMatch, tournamentMatchId])

  // Room abandoned → return to tournament page (or home) after a brief notice
  useEffect(() => {
    if (!abandoned) return
    const id = setTimeout(() => {
      reset()
      navigate(isTournamentMatch ? `/tournaments/${tournamentId}` : '/', { replace: true })
    }, 3000)
    return () => clearTimeout(id)
  }, [abandoned])

  // Kicked (spectator idle) → go home
  useEffect(() => {
    if (!kicked) return
    reset()
    navigate('/', { replace: true })
  }, [kicked])

  // No join slug → nothing to do here
  if (!joinSlug) return <Navigate to="/" replace />

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

  // Waiting for opponent to join
  if (status === 'waiting') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <div
          className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
        />
        <p style={{ color: 'var(--text-secondary)' }}>
          {isTournamentMatch ? 'Waiting for opponent…' : 'Joining room…'}
        </p>
      </div>
    )
  }

  // Room abandoned overlay
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

  // Active or finished match
  if (status === 'playing' || status === 'finished') {
    return (
      <>
        <div className="flex flex-col items-center w-full max-w-md mx-auto">
          <PvPBoard />
        </div>
        <IdleWarningPopup />
      </>
    )
  }

  // Idle — still waiting for useEffect to fire (first render)
  return null
}
