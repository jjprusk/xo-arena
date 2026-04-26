// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { lazy, useEffect, useState } from 'react'
import { useSearchParams, useNavigate, Link, Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'
import { useGameSDK } from '../lib/useGameSDK.js'
import { getCommunityBot } from '../lib/communityBotCache.js'
import PlatformShell from '../components/platform/PlatformShell.jsx'
import { perfMark, perfDumpSummary } from '../lib/perfLog.js'
import { recordGuestHookStep1 } from '../lib/guestMode.js'
import { useGuideStore } from '../store/guideStore.js'
import { deriveCurrentPhase } from '../components/guide/JourneyCard.jsx'
import SignInModal from '../components/ui/SignInModal.jsx'
import { api } from '../lib/api.js'
import { getToken } from '../lib/getToken.js'

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

  const [gameState, setGameState] = useState({ currentTurn: null, winner: null, isDraw: false })

  const { session, sdk, phase, abandoned, kicked, seriesResult, opponentLeft } = useGameSDK({
    gameId:           'xo',
    joinSlug,
    tournamentMatchId,
    tournamentId,
    currentUser,
    botUserId:  botConfig?.botUserId  ?? null,
    botSkillId: botConfig?.botSkillId ?? null,
  })

  // Subscribe to move events to drive seat-pod states in the shell
  useEffect(() => {
    return sdk.onMove(({ state }) => {
      setGameState({
        currentTurn: state.currentTurn ?? null,
        winner:      state.winner      ?? null,
        isDraw:      state.status === 'finished' && !state.winner,
      })
    })
  }, [sdk])

  // Phase-aware leave destination. While the user is still in the Hook phase
  // (or is a guest, who derives to 'hook' by default), dropping them in the
  // /tables list after a quick PvAI game is a flat dead-end — the welcome
  // funnel is supposed to lead back to the landing page. Once they've cleared
  // Hook (Curriculum / Specialize), /tables is the right destination because
  // they're navigating around an arena, not being onboarded.
  const completedSteps = useGuideStore(s => s.journeyProgress?.completedSteps ?? [])
  const inHookPhase = deriveCurrentPhase(completedSteps) === 'hook'
  const leaveHref = tournamentId
    ? `/tournaments/${tournamentId}`
    : (inHookPhase ? '/' : '/tables')

  // Register leave-table callback so sdk.leaveTable() navigates away
  useEffect(() => {
    sdk._onGameEnd(({ leave } = {}) => {
      if (leave) navigate(leaveHref, { replace: true })
    })
  }, [sdk]) // eslint-disable-line react-hooks/exhaustive-deps

  // Abandoned → navigate away after brief notice
  useEffect(() => {
    if (!abandoned) return
    const id = setTimeout(() => navigate(leaveHref, { replace: true }), 3000)
    return () => clearTimeout(id)
  }, [abandoned]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opponent left post-game → navigate after brief notice
  useEffect(() => {
    if (!opponentLeft) return
    const id = setTimeout(() => navigate(leaveHref, { replace: true }), 3000)
    return () => clearTimeout(id)
  }, [opponentLeft]) // eslint-disable-line react-hooks/exhaustive-deps

  // Kicked (spectator inactivity) → go home
  useEffect(() => {
    if (!kicked) return
    navigate('/', { replace: true })
  }, [kicked]) // eslint-disable-line react-hooks/exhaustive-deps

  // Guest Hook step 1 — Phase 0 (Intelligent Guide v1, §3.5.2). When an
  // unauthenticated visitor finishes a vs-community-bot game, persist step 1
  // to localStorage so it can be credited on signup. Helper is idempotent.
  // We only fire for vs-bot guest games (no currentUser AND a botConfig is set);
  // tournament-routed and PvP paths are skipped.
  const isGuestPvAI = !currentUser && !!botConfig
  useEffect(() => {
    if (!isGuestPvAI) return
    if (gameState.winner || gameState.isDraw) recordGuestHookStep1()
  }, [isGuestPvAI, gameState.winner, gameState.isDraw])

  // Post-game signup CTA for guest PvAI — Phase 0's high-intent conversion
  // moment. The hero ladder on / is the other signup surface; this one fires
  // right after the player has invested in a finished game.
  //
  // UX shape: top-of-viewport toast that appears 2s AFTER the game ends (so
  // the result + side panel get their moment uncluttered), then pulses for
  // ~5s to grab attention, then fades to a low-opacity ambient state (still
  // clickable, not blocking). Dismiss × removes entirely. Resets on rematch.
  const [signupOpen, setSignupOpen]           = useState(false)
  const [signupDismissed, setSignupDismissed] = useState(false)
  const [ctaArmed, setCtaArmed]               = useState(false)
  const [ctaFaded, setCtaFaded]               = useState(false)

  const gameFinished = phase === 'finished' && (gameState.winner || gameState.isDraw)
  const showGuestSignupCta =
    isGuestPvAI && gameFinished && ctaArmed && !signupOpen && !signupDismissed

  useEffect(() => {
    if (!isGuestPvAI || !gameFinished) { setCtaArmed(false); setCtaFaded(false); return }
    const armTimer  = setTimeout(() => setCtaArmed(true),  2000)
    const fadeTimer = setTimeout(() => setCtaFaded(true),  7000)
    return () => { clearTimeout(armTimer); clearTimeout(fadeTimer) }
  }, [isGuestPvAI, gameFinished])

  useEffect(() => {
    if (phase === 'playing') setSignupDismissed(false)
  }, [phase])

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
          Returning…
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

  // Still connecting (no session yet) — raw spinner
  if (phase === 'connecting') return <Spinner />

  // Waiting, playing, or finished — all route through the platform shell
  if ((phase === 'waiting' || phase === 'playing' || phase === 'finished') && session) {
    if (phase === 'playing') {
      perfMark('PlayPage:board-renderable')
      perfDumpSummary('/play?action=vs-community-bot')
    }
    // Spectator count: prefer the socket-driven value in session.settings
    // (populated by useGameSDK on room:joined + room:spectatorJoined). Fall
    // back to the SSE presence stream count passed in from TableDetailPage.
    const liveSpectatorCount = session?.settings?.spectatorCount ?? spectatingCount

    return (
      <>
        <PlatformShell
          gameMeta={xoMeta}
          session={session}
          phase={phase}
          gameState={gameState}
          spectatorCount={liveSpectatorCount}
          tournamentId={tournamentId}
          backHref={leaveHref}
          minimalChrome={isGuestPvAI}
        >
          {(phase === 'playing' || phase === 'finished') && (
            <XOGame session={session} sdk={sdk} />
          )}
        </PlatformShell>

        {showGuestSignupCta && (
          <div
            className={`fixed left-0 right-0 z-40 px-3 sm:px-4 pointer-events-none transition-opacity duration-700 animate-fade-up ${ctaFaded ? 'opacity-50 hover:opacity-100' : 'opacity-100'}`}
            style={{ top: '4.5rem' }}
            data-testid="guest-signup-cta"
          >
            <div
              className="pointer-events-auto mx-auto max-w-sm flex items-center gap-2 px-3 py-2.5 rounded-xl shadow-2xl"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border:          '2px solid var(--color-primary)',
              }}
            >
              <span
                className="text-sm font-medium flex-1 min-w-0"
                style={{ color: 'var(--text-primary)' }}
              >
                Like this? Save your progress.
              </span>
              <button
                type="button"
                onClick={() => setSignupOpen(true)}
                className={`btn btn-primary btn-sm whitespace-nowrap ${ctaFaded ? '' : 'guide-pulse'}`}
                data-cta="build-your-own-bot"
              >
                Build your own bot →
              </button>
              <button
                type="button"
                onClick={() => setSignupDismissed(true)}
                aria-label="Dismiss"
                className="ml-1 px-2 text-xl leading-none flex-shrink-0"
                style={{ color: 'var(--text-secondary)' }}
              >
                ×
              </button>
            </div>
          </div>
        )}

        {signupOpen && (
          <SignInModal
            onClose={() => setSignupOpen(false)}
            onSuccess={() => navigate('/', { replace: true })}
            defaultView="sign-up"
            context="build-bot"
          />
        )}
      </>
    )
  }

  return <Spinner />
}

export default function PlayPage() {
  perfMark('PlayPage:render')
  const [searchParams]         = useSearchParams()
  const { data: authSession }  = useOptimisticSession()
  const navigate               = useNavigate()

  const joinSlug          = searchParams.get('join')
  const tournamentMatchId = searchParams.get('tournamentMatch')
  const tournamentId      = searchParams.get('tournamentId')
  const action            = searchParams.get('action')
  const botUserId         = searchParams.get('botUserId')
  const botSkillId        = searchParams.get('botSkillId')

  // Key that changes when auth identity changes — forces GameView to fully
  // unmount and remount (new useGameSDK, new socket mapping, new game).
  // Without this, a guest signing in mid-game keeps the old GameView mounted
  // with stale guest:socketId marks that don't match the new betterAuthId.
  const gameKey = authSession?.user?.id ?? 'guest'

  const [botConfig, setBotConfig] = useState(null)   // { botUserId, botSkillId }
  const [botError, setBotError]   = useState(false)
  const [demoError, setDemoError] = useState(false)

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

  // Watch-demo: spawn a private bot-vs-bot demo table (Hook step 2) and
  // redirect to /tables/:id to spectate. The trigger that credits step 2
  // fires server-side on participant:joined as soon as the demo starts.
  useEffect(() => {
    if (action !== 'watch-demo') return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) {
          // Demo creation requires auth (private table, createdById). The
          // journey link only renders post-signup, so missing token means
          // session expired — bounce home and let the auth flow recover.
          if (!cancelled) navigate('/', { replace: true })
          return
        }
        const res = await api.tables.createDemo(token)
        if (cancelled) return
        navigate(`/tables/${res.tableId}`, { replace: true })
      } catch {
        if (!cancelled) setDemoError(true)
      }
    })()
    return () => { cancelled = true }
  }, [action]) // eslint-disable-line react-hooks/exhaustive-deps

  // No join slug, no recognised action, and no direct bot params → home
  if (!joinSlug && !action && !botUserId) return <Navigate to="/" replace />

  // Bot fetch failed → back to home
  if (botError) return <Navigate to="/" replace />

  // Demo create failed → back to home
  if (demoError) return <Navigate to="/" replace />

  // Watch-demo: render spinner while the demo table is being spawned;
  // the effect above redirects to /tables/:id once the response lands.
  if (action === 'watch-demo') return <Spinner />

  // Waiting for community bot to be resolved
  if (action === 'vs-community-bot' && !joinSlug && !botConfig) return <Spinner />

  // Resolve final botConfig: community-bot fetch result or direct URL params
  const resolvedBotConfig = action === 'vs-community-bot'
    ? botConfig
    : botUserId
      ? { botUserId, botSkillId: botSkillId ?? null }
      : null

  return (
    <GameView
      key={gameKey}
      joinSlug={joinSlug}
      tournamentMatchId={tournamentMatchId}
      tournamentId={tournamentId}
      authSession={authSession}
      botConfig={resolvedBotConfig}
    />
  )
}
