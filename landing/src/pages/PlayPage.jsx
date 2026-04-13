// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { lazy, Suspense, useEffect } from 'react'
import { useSearchParams, useNavigate, Link, Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useGameSDK } from '../lib/useGameSDK.js'

// Load XO via React.lazy — satisfies the GameContract from @callidity/sdk
const XOGame = lazy(() => import('@callidity/game-xo'))

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <div
        className="w-8 h-8 border-4 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
      />
    </div>
  )
}

export default function PlayPage() {
  const [searchParams] = useSearchParams()
  const navigate       = useNavigate()
  const { data: authSession } = useOptimisticSession()

  const joinSlug          = searchParams.get('join')
  const tournamentMatchId = searchParams.get('tournamentMatch')
  const tournamentId      = searchParams.get('tournamentId')

  const currentUser = authSession?.user
    ? { id: authSession.user.id, displayName: authSession.user.name ?? authSession.user.email }
    : null

  const { session, sdk, phase, abandoned, kicked, seriesResult } = useGameSDK({
    gameId:           'xo',
    joinSlug,
    tournamentMatchId,
    tournamentId,
    currentUser,
  })

  // Abandoned → navigate away after brief notice
  useEffect(() => {
    if (!abandoned) return
    const id = setTimeout(() => {
      navigate(tournamentId ? `/tournaments/${tournamentId}` : '/', { replace: true })
    }, 3000)
    return () => clearTimeout(id)
  }, [abandoned])

  // Kicked (spectator inactivity) → go home
  useEffect(() => {
    if (!kicked) return
    navigate('/', { replace: true })
  }, [kicked])

  // No slug and no create intent → go home
  if (!joinSlug && phase === 'connecting') {
    // Allow a brief moment for room:create to fire
    // If still connecting after mount it means there's no intent — redirect
  }

  // Tournament series complete screen
  if (seriesResult) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 max-w-sm mx-auto text-center">
        <div className="text-5xl">🏆</div>
        <p className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
          Series Complete
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          {seriesResult.p1Wins} – {seriesResult.p2Wins}
        </p>
        <Link
          to={`/tournaments/${tournamentId}`}
          className="btn btn-primary"
        >
          Back to Tournament
        </Link>
      </div>
    )
  }

  // Room abandoned
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

  // Waiting for opponent
  if (phase === 'connecting' || phase === 'waiting') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <Spinner />
        <p style={{ color: 'var(--text-secondary)' }}>
          {tournamentMatchId ? 'Waiting for opponent…' : phase === 'waiting' ? 'Waiting for opponent to join…' : 'Connecting…'}
        </p>
        {phase === 'waiting' && session?.tableId && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Room: {session.settings?.displayName}
            </p>
            <p className="text-xs font-mono px-3 py-1 rounded-lg select-all"
               style={{ background: 'var(--bg-surface-hover)', color: 'var(--text-secondary)' }}>
              {window.location.origin}/play?join={session.tableId}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Share this link with your opponent
            </p>
          </div>
        )}
      </div>
    )
  }

  // Active or finished game
  if ((phase === 'playing' || phase === 'finished') && session) {
    return (
      <div className="relative flex flex-col items-center w-full max-w-md mx-auto py-6 px-4">
        {/* Escape affordance — visible during play so the player can always leave */}
        <Link
          to={tournamentId ? `/tournaments/${tournamentId}` : '/'}
          className="absolute top-0 left-0 flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-opacity opacity-30 hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          title="Back to Arena"
        >
          ← Arena
        </Link>
        <Suspense fallback={<Spinner />}>
          <XOGame session={session} sdk={sdk} />
        </Suspense>
      </div>
    )
  }

  return <Spinner />
}
