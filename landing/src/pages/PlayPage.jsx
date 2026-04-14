// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { lazy, Suspense, useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link, Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useGameSDK } from '../lib/useGameSDK.js'
import { meta as xoMeta } from '@callidity/game-xo'
import { api } from '../lib/api.js'
import { getCommunityBot } from '../lib/communityBotCache.js'

// Load XO via React.lazy — satisfies the GameContract from @callidity/sdk
const XOGame = lazy(() => import('@callidity/game-xo'))

const WIDTH_CLASS = {
  compact:    'max-w-sm',
  standard:   'max-w-md',
  wide:       'max-w-2xl',
  fullscreen: 'max-w-full',
}
const gameWidthClass = WIDTH_CLASS[xoMeta.layout?.preferredWidth ?? 'standard'] ?? 'max-w-md'

function resolveThemeVars(theme, isDark) {
  return {
    ...theme?.tokens,
    ...(isDark ? theme?.dark : theme?.light),
  }
}

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

// Inner component — only mounted once botConfig is resolved (or not needed).
// Keeps all hook calls stable regardless of async bot fetch.
function GameView({ joinSlug, tournamentMatchId, tournamentId, authSession, botConfig }) {
  const navigate = useNavigate()

  const currentUser = authSession?.user
    ? { id: authSession.user.id, displayName: authSession.user.name ?? authSession.user.email }
    : null

  const { session, sdk, phase, abandoned, kicked, seriesResult } = useGameSDK({
    gameId:           'xo',
    joinSlug,
    tournamentMatchId,
    tournamentId,
    currentUser,
    botUserId:  botConfig?.botUserId  ?? null,
    botSkillId: botConfig?.botSkillId ?? null,
  })

  // Register leave-table callback so sdk.leaveTable() navigates away
  useEffect(() => {
    sdk._onGameEnd(({ leave } = {}) => {
      if (leave) navigate(tournamentId ? `/tournaments/${tournamentId}` : '/', { replace: true })
    })
  }, [sdk]) // eslint-disable-line react-hooks/exhaustive-deps

  // Abandoned → navigate away after brief notice
  useEffect(() => {
    if (!abandoned) return
    const id = setTimeout(() => {
      navigate(tournamentId ? `/tournaments/${tournamentId}` : '/', { replace: true })
    }, 3000)
    return () => clearTimeout(id)
  }, [abandoned]) // eslint-disable-line react-hooks/exhaustive-deps

  // Kicked (spectator inactivity) → go home
  useEffect(() => {
    if (!kicked) return
    navigate('/', { replace: true })
  }, [kicked]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <Link to={`/tournaments/${tournamentId}`} className="btn btn-primary">
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

  // Waiting for opponent (PvP only — bot games go straight to playing)
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
      <div
        className={`relative flex flex-col items-center w-full ${gameWidthClass} mx-auto py-6 px-4`}
        style={resolveThemeVars(xoMeta.theme, document.documentElement.classList.contains('dark'))}
      >
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

export default function PlayPage() {
  const [searchParams]         = useSearchParams()
  const { data: authSession }  = useOptimisticSession()

  const joinSlug          = searchParams.get('join')
  const tournamentMatchId = searchParams.get('tournamentMatch')
  const tournamentId      = searchParams.get('tournamentId')
  const action            = searchParams.get('action')

  const [botConfig, setBotConfig] = useState(null)   // { botUserId, botSkillId }
  const [botError, setBotError]   = useState(false)

  // Preload the game chunk immediately — runs in parallel with the bot fetch
  // so the chunk is ready by the time phase becomes 'playing'.
  useEffect(() => { import('@callidity/game-xo').catch(() => {}) }, [])

  // Resolve community bot — uses the module-level cache so repeated plays
  // and navigations from HomePage (which prefetches) skip the round-trip.
  useEffect(() => {
    if (action !== 'vs-community-bot' || joinSlug) return
    getCommunityBot()
      .then(config => { config ? setBotConfig(config) : setBotError(true) })
      .catch(() => setBotError(true))
  }, [action, joinSlug])

  // No join slug and no recognised action → home
  if (!joinSlug && !action) return <Navigate to="/" replace />

  // Bot fetch failed → back to home
  if (botError) return <Navigate to="/" replace />

  // Waiting for community bot to be resolved
  if (action === 'vs-community-bot' && !joinSlug && !botConfig) return <Spinner />

  return (
    <GameView
      joinSlug={joinSlug}
      tournamentMatchId={tournamentMatchId}
      tournamentId={tournamentId}
      authSession={authSession}
      botConfig={action === 'vs-community-bot' ? botConfig : null}
    />
  )
}
