// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { lazy, useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link, Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useGameSDK } from '../lib/useGameSDK.js'
import { getCommunityBot } from '../lib/communityBotCache.js'
import PlatformShell from '../components/platform/PlatformShell.jsx'
import { perfMark, perfDumpSummary } from '../lib/perfLog.js'

// Load XO via React.lazy — satisfies the GameContract from @callidity/sdk
// Note: we deliberately do NOT statically import `meta` from @callidity/game-xo
// at the top of this file. A synchronous import would force Vite to compile the
// entire game module graph (React + JSX + deps) before PlayPage can render its
// spinner — adding 1–2s on /play page reload in dev mode. Instead, we load meta
// asynchronously below and fall back to sensible defaults while it loads.
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

// Inner component — only mounted once botConfig is resolved (or not needed).
// Keeps all hook calls stable regardless of async bot fetch.
// Exported so TableDetailPage can render a table-routed game without duplicating this logic.
export function GameView({ joinSlug, tournamentMatchId, tournamentId, authSession, botConfig, spectatingCount = 0 }) {
  const navigate = useNavigate()

  // Load game meta asynchronously — see comment at top of file. While null we
  // use 'standard' width and no theme tokens. By the time phase === 'playing'
  // the lazy import of XOGame is also done, so meta is reliably populated.
  const [xoMeta, setXoMeta] = useState(null)
  useEffect(() => {
    import('@callidity/game-xo').then(m => setXoMeta(m.meta)).catch(() => {})
  }, [])

  const currentUser = authSession?.user
    ? { id: authSession.user.id, displayName: authSession.user.name ?? authSession.user.email }
    : null

  const { session, sdk, phase, abandoned, kicked, seriesResult, opponentLeft } = useGameSDK({
    gameId:           'xo',
    joinSlug,
    tournamentMatchId,
    tournamentId,
    currentUser,
    botUserId:  botConfig?.botUserId  ?? null,
    botSkillId: botConfig?.botSkillId ?? null,
  })

  const tablesHref = tournamentId ? `/tournaments/${tournamentId}` : '/tables'

  // Register leave-table callback so sdk.leaveTable() navigates away
  useEffect(() => {
    sdk._onGameEnd(({ leave } = {}) => {
      if (leave) navigate(tablesHref, { replace: true })
    })
  }, [sdk]) // eslint-disable-line react-hooks/exhaustive-deps

  // Abandoned → navigate away after brief notice
  useEffect(() => {
    if (!abandoned) return
    const id = setTimeout(() => navigate(tablesHref, { replace: true }), 3000)
    return () => clearTimeout(id)
  }, [abandoned]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opponent left post-game → navigate after brief notice
  useEffect(() => {
    if (!opponentLeft) return
    const id = setTimeout(() => navigate(tablesHref, { replace: true }), 3000)
    return () => clearTimeout(id)
  }, [opponentLeft]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Opponent left after game ended
  if (opponentLeft) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <div className="text-4xl">👋</div>
        <p className="text-lg font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
          Opponent has left the table
        </p>
        <p className="text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
          Returning to Tables…
        </p>
      </div>
    )
  }

  // Table abandoned (inactivity)
  if (abandoned) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <div className="text-4xl">💤</div>
        <p className="text-lg font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
          Table closed due to inactivity
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
              Table: {session.settings?.displayName}
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

  // Active or finished game — route through the platform shell so the same
  // chrome renders on /play and (Phase 3.4) /tables/:id.
  if ((phase === 'playing' || phase === 'finished') && session) {
    perfMark('PlayPage:board-renderable')
    perfDumpSummary('/play?action=vs-community-bot')
    return (
      <PlatformShell
        gameMeta={xoMeta}
        session={session}
        phase={phase}
        spectatorCount={spectatingCount}
        backHref={tournamentId ? `/tournaments/${tournamentId}` : '/'}
      >
        <XOGame session={session} sdk={sdk} />
      </PlatformShell>
    )
  }

  return <Spinner />
}

export default function PlayPage() {
  perfMark('PlayPage:render')
  const [searchParams]         = useSearchParams()
  const { data: authSession }  = useOptimisticSession()

  const joinSlug          = searchParams.get('join')
  const tournamentMatchId = searchParams.get('tournamentMatch')
  const tournamentId      = searchParams.get('tournamentId')
  const action            = searchParams.get('action')

  // Key that changes when auth identity changes — forces GameView to fully
  // unmount and remount (new useGameSDK, new socket mapping, new game).
  // Without this, a guest signing in mid-game keeps the old GameView mounted
  // with stale guest:socketId marks that don't match the new betterAuthId.
  const gameKey = authSession?.user?.id ?? 'guest'

  const [botConfig, setBotConfig] = useState(null)   // { botUserId, botSkillId }
  const [botError, setBotError]   = useState(false)

  // Game chunk is preloaded at the module level in AppLayout — no need to re-trigger here.

  // Resolve community bot — uses the module-level cache so repeated plays
  // and navigations from HomePage (which prefetches) skip the round-trip.
  useEffect(() => {
    if (action !== 'vs-community-bot' || joinSlug) return
    perfMark('PlayPage:botConfig-start')
    getCommunityBot()
      .then(config => {
        perfMark('PlayPage:botConfig-done', config ? 'ok' : 'null')
        config ? setBotConfig(config) : setBotError(true)
      })
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
      key={gameKey}
      joinSlug={joinSlug}
      tournamentMatchId={tournamentMatchId}
      tournamentId={tournamentId}
      authSession={authSession}
      botConfig={action === 'vs-community-bot' ? botConfig : null}
    />
  )
}
