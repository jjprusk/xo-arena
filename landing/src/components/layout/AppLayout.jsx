// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useOptimisticSession, clearSessionCache, triggerSessionRefresh } from '../../lib/useOptimisticSession.js'
import { signOut } from '../../lib/auth-client.js'
import { getToken, clearTokenCache } from '../../lib/getToken.js'
import { perfMark } from '../../lib/perfLog.js'
import SignInModal from '../ui/SignInModal.jsx'
import EmailVerifyBanner from '../ui/EmailVerifyBanner.jsx'
import GuideOrb from '../guide/GuideOrb.jsx'
import GuidePanel from '../guide/GuidePanel.jsx'
import RewardPopup from '../guide/RewardPopup.jsx'
import CoachingCard from '../guide/CoachingCard.jsx'
import FeedbackButton from '../feedback/FeedbackButton.jsx'
import AudioDebugOverlay from '../debug/AudioDebugOverlay.jsx'
import { useGuideStore } from '../../store/guideStore.js'
import { useNotifSoundStore } from '../../store/notifSoundStore.js'
import { useJourneyAutoOpen } from '../../lib/useJourneyAutoOpen.js'
import { useEventStream, reopenSharedStream } from '../../lib/useEventStream.js'
import { useHeartbeat } from '../../lib/useHeartbeat.js'
import { TOTAL_STEPS } from '../guide/journeySteps.js'
import { AppNav } from '@xo-arena/nav'

// Kick off the game-xo chunk download immediately on app load — by the time
// the user navigates to /play the module graph is already compiled and cached.
import('@callidity/game-xo').catch(() => {})

const LANDING_URL = import.meta.env.VITE_LANDING_URL  ?? 'https://aiarena.callidity.com'
const APP_URLS    = { landing: LANDING_URL, xo: LANDING_URL }

/**
 * Map a raw bus notification { type, payload } to the shape NotificationCard expects:
 * { id, type (UI category), uiType, title, body, href }
 */
function normalizeBusNotification(type, payload = {}, expiresAt = null) {
  const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const tid = payload.tournamentId
  const tname = payload.name ?? 'Tournament'
  const exp = expiresAt ?? null

  switch (type) {
    case 'tournament.published':
      return { id, uiType: 'tournament',  type: 'tournament',  title: `${tname} — registration open`, body: 'New tournament announced', href: '/tournaments', expiresAt: exp }
    case 'tournament.flash_announced':
      return { id, uiType: 'flash',       type: 'flash',       title: `${tname} — registration open`, body: 'Flash tournament announced', href: '/tournaments', expiresAt: exp }
    case 'tournament.recurring_occurrence_opened':
      return { id, uiType: 'tournament',  type: 'tournament',  title: `${tname} — you're entered`, body: 'Today\'s occurrence is open — you were auto-enrolled', href: tid ? `/tournaments/${tid}` : '/tournaments', expiresAt: exp }
    case 'tournament.registration_closing':
      return { id, uiType: 'tournament',  type: 'tournament',  title: `${tname} — registration closing`, body: 'Last chance to register', href: tid ? `/tournaments/${tid}` : '/tournaments', expiresAt: exp }
    case 'tournament.starting_soon':
      return { id, uiType: 'tournament',  type: 'tournament',  title: `${tname} starts in ${payload.minutesUntilStart}m`, body: 'Your match is coming up', href: tid ? `/tournaments/${tid}` : '/tournaments', expiresAt: exp }
    case 'tournament.started':
      return { id, uiType: 'tournament',  type: 'tournament',  title: `${tname} has started!`, body: 'Check your first match', href: tid ? `/tournaments/${tid}` : '/tournaments', expiresAt: exp }
    case 'tournament.cancelled':
      return { id, uiType: 'tournament',  type: 'tournament',  title: `${tname} cancelled`, body: 'The tournament was cancelled', href: '/tournaments', expiresAt: exp }
    case 'tournament.completed':
      return { id, uiType: 'tournament',  type: 'tournament',  title: `${tname} complete`, body: 'See the final results', href: tid ? `/tournaments/${tid}` : '/tournaments', expiresAt: exp }
    case 'match.ready':
      return { id, uiType: 'match_ready', type: 'match_ready', title: 'Match Ready!', body: `Your match in ${tname} is ready`, href: tid ? `/tournaments/${tid}` : '/tournaments', expiresAt: exp }
    case 'match.result':
      return { id, uiType: 'tournament',  type: 'tournament',  title: 'Match Result', body: `Result recorded for ${tname}`, href: tid ? `/tournaments/${tid}` : '/tournaments', expiresAt: exp }
    case 'achievement.tier_upgrade':
      return { id, uiType: 'admin',       type: 'admin',       title: `Tier upgrade — ${payload.tier ?? ''}`, body: payload.message, expiresAt: null }
    case 'achievement.milestone':
      return { id, uiType: 'admin',       type: 'admin',       title: `Milestone reached`, body: payload.message, expiresAt: null }
    case 'admin.announcement':
      return { id, uiType: 'admin',       type: 'admin',       title: 'Announcement', body: payload.message, expiresAt: null }
    case 'system.alert':
      return { id, uiType: 'admin',       type: 'admin',       title: 'System Alert', body: payload.message, expiresAt: null }
    case 'system.alert.cleared':
      return { id, uiType: 'admin',       type: 'admin',       title: 'Alert Cleared', body: payload.message, expiresAt: null }
    // Table state-nudge events (Phase 3.2): infrastructure for lists/seat
    // strips. Suppressed from the notification stack — the relevant UI
    // already reflects the state, and broadcasting these to every
    // connected user would be noisy.
    case 'table.created':
    case 'spectator.joined':
    case 'table.empty':
    case 'table.started':
    case 'table.completed':
    case 'table.deleted':
      return null
    // Seat changes ARE surfaced, but only for stakeholders (creator or
    // currently seated). The upstream handler in onGuideNotification filters
    // by payload.stakeholders before calling into this normalizer, so by the
    // time we get here the event is already known to be relevant.
    case 'player.joined': {
      const who      = payload.actorDisplayName ?? 'Someone'
      const gameName = payload.gameId === 'xo' ? 'XO' : (payload.gameId ?? 'table')
      const seat     = Number.isInteger(payload.seatIndex) ? `seat ${payload.seatIndex + 1}` : 'a seat'
      return {
        id,
        uiType:    'table',
        type:      'table',
        tableId:   payload.tableId ?? null,
        title:     `${who} took ${seat}`,
        body:      `Your ${gameName} table`,
        href:      payload.tableId ? `/tables/${payload.tableId}` : null,
        expiresAt: exp,
      }
    }
    case 'player.left': {
      const who      = payload.actorDisplayName ?? 'Someone'
      const gameName = payload.gameId === 'xo' ? 'XO' : (payload.gameId ?? 'table')
      const seat     = Number.isInteger(payload.seatIndex) ? `seat ${payload.seatIndex + 1}` : 'a seat'
      return {
        id,
        uiType:    'table',
        type:      'table',
        tableId:   payload.tableId ?? null,
        title:     `${who} left ${seat}`,
        body:      `Your ${gameName} table`,
        href:      payload.tableId ? `/tables/${payload.tableId}` : null,
        expiresAt: exp,
      }
    }
    default:
      return { id, uiType: 'admin',       type: 'admin',       title: type, body: payload.message ?? '', expiresAt: null }
  }
}

export default function AppLayout() {
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const [showSignIn, setShowSignIn] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // Mirror of session?.user?.id (the betterAuthId) so the long-lived
  // guide:notification listener — registered once on mount — can filter
  // stakeholder-scoped events (player.joined / player.left) against the
  // CURRENT user without re-registering on every sign-in/out.
  const myBaIdRef = useRef(null)
  useEffect(() => { myBaIdRef.current = user?.id ?? null }, [user?.id])

  // When sign-in / sign-out / account-switch flips identity, the shared
  // EventSource is still registered on the server with the *previous* user
  // id (or null for guest). Personal channels (`guide:journeyStep`,
  // `guide:hook_complete`, `user:<id>:idle`, …) are filtered by userId in
  // sseBroker, so the new identity's events go to /dev/null until we open a
  // fresh /events/stream that re-registers with the right id.
  const prevUserIdRef = useRef(user?.id ?? null)
  useEffect(() => {
    const next = user?.id ?? null
    if (prevUserIdRef.current !== next) {
      prevUserIdRef.current = next
      reopenSharedStream()
    }
  }, [user?.id])

  useJourneyAutoOpen(user?.id ?? null)

  // Track the previous pathname so we can detect /play → non-/play transitions
  // (i.e. "just finished playing"). Updated at the top of the navigation effect
  // below so downstream effects in the same tick still see the previous value.
  const prevPathRef = useRef(location.pathname)

  // Last-seen completedSteps length, used by the missed-event recovery in the
  // hydrate effect below. Starts at -1 so the very first hydrate after sign-in
  // is recognized as growth and the panel opens for an in-progress journey.
  const lastSeenStepCountRef = useRef(-1)

  // Close user dropdown and guide panel whenever the user navigates — unless
  // the user just left /play. After a game, the journey card almost always
  // has something fresh to show (step 3 advance, badge), so keep the Guide
  // visible. The re-hydrate effect below picks an open/stay-closed decision
  // based on journey state.
  useEffect(() => {
    setUserMenuOpen(false)
    const prevPath = prevPathRef.current
    if (!prevPath.startsWith('/play')) {
      useGuideStore.getState().close()
    }
  }, [location.pathname])

  // Re-hydrate the guide store on non-/play navigation. Recovers from socket
  // events we may have missed during gameplay (e.g. brief disconnect, subscribe
  // race, backend restart). Cheap GET; runs once per non-/play route change.
  //
  // When transitioning FROM /play back HOME, also reopen the Guide synchronously
  // if the journey is still active — step 1 / step 3 likely just advanced and
  // the user should see the progress land on the home journey card.
  //
  // Scoped to currPath === '/' specifically: /play is sometimes used as a transit
  // route (e.g. /play?action=watch-demo immediately replace-redirects to
  // /tables/<id> for spectating), and re-opening the panel on those landings
  // overlays the destination page with the panel backdrop.
  useEffect(() => {
    if (!session?.user?.id) return
    const prevPath = prevPathRef.current
    const currPath = location.pathname
    prevPathRef.current = currPath
    if (currPath.startsWith('/play')) return

    if (prevPath.startsWith('/play') && currPath === '/') {
      const { journeyProgress } = useGuideStore.getState()
      const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
      if (!dismissedAt && completedSteps.length < TOTAL_STEPS) {
        useGuideStore.getState().open()
      }
    }

    // After hydrate(), if the journey advanced since the last time we looked,
    // open the panel. Catches missed `guide:journeyStep` events (e.g. an SSE
    // reopen race during a bot-create POST swallowed the live event, but
    // the server-side state did advance). We compare against a ref of the
    // last seen completedSteps length — only opening on growth, never on
    // mere navigation, so the panel doesn't pop on every route change.
    //
    // The very first hydrate of the session does NOT trigger an open: the
    // user could be mid-flow (e.g. mid-demo on /tables/<id>) and a "you have
    // 1 step done" pop is just noise, not a missed-event recovery. We only
    // act on growth observed *after* a baseline is established.
    //
    // Suppressed when `?action=*` is present in the URL — that means the
    // user is intentionally following a journey CTA (e.g. /profile?action=
    // quick-bot to open the bot wizard) and the destination page has its
    // own opinion about whether the panel should be open. The SSE listener
    // below still updates `journeyProgress` in the store either way.
    const hasActionParam = new URLSearchParams(location.search).has('action')
    useGuideStore.getState().hydrate().then(() => {
      const { journeyProgress } = useGuideStore.getState()
      const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
      const prevSeen   = lastSeenStepCountRef.current
      const isBaseline = prevSeen === -1
      lastSeenStepCountRef.current = completedSteps.length
      if (
        !hasActionParam
        && !isBaseline
        && !dismissedAt
        && completedSteps.length > prevSeen
        && completedSteps.length < TOTAL_STEPS
      ) {
        useGuideStore.getState().open()
      }
    })
  }, [location.pathname, session?.user?.id])

  // No socket pre-warm: empirically, an idle pre-warmed polling socket goes
  // stale (server expires the SID), and the 400 + reconnect cycle on first
  // event is 5-10× slower than a fresh on-demand handshake (~1100ms vs ~100ms).
  // useGameSDK connects the socket itself when /play mounts.

  // Connect socket and hydrate guide on sign-in; open panel if journey is incomplete; reset on sign-out.
  useEffect(() => {
    if (session?.user?.id) {
      perfMark('AppLayout:session-resolved', session.user.id)
      // Skip guide hydrate on /play — the panel is suppressed on that route,
      // so the extra /api/v1/guide/preferences round trip is pure waste on
      // the game hot path. Other routes hydrate as before.
      const onPlayRoute = window.location.pathname.startsWith('/play')
      if (!onPlayRoute) {
        useGuideStore.getState().hydrate().then(() => {
          perfMark('AppLayout:hydrate-done')
          const { journeyProgress } = useGuideStore.getState()
          const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
          if (!dismissedAt && completedSteps.length < TOTAL_STEPS) {
            useGuideStore.getState().open()
          }
        })
      }
    } else {
      useGuideStore.getState().reset()
    }
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshOnlineFromRestRef  = useRef(null)
  function refreshOnlineFromRest() { refreshOnlineFromRestRef.current?.() }

  function onGuideNotification({ type, payload = {}, expiresAt = null }) {
    // When a game starts, the "took a seat" notifications for that table are
    // stale — the game is underway so the seat context is already obvious.
    if (type === 'table.started' && payload?.tableId) {
      useGuideStore.getState().dismissNotificationsForTable(payload.tableId)
      return
    }
    // Stakeholder filter for seat-change events: surface only to the table's
    // creator or anyone currently seated; exclude the actor themselves.
    if (type === 'player.joined' || type === 'player.left') {
      const myBaId = myBaIdRef.current
      if (!myBaId) return
      if (payload.userId === myBaId) return
      const stakes = Array.isArray(payload.stakeholders) ? payload.stakeholders : []
      if (!stakes.includes(myBaId)) return
    }
    const notif = normalizeBusNotification(type, payload, expiresAt)
    if (!notif) return
    useGuideStore.getState().addNotification(notif)
    useNotifSoundStore.getState().play()
    if (notif.uiType === 'flash' || notif.uiType === 'match_ready') {
      if (!useGuideStore.getState().panelOpen) useGuideStore.getState().open()
    }
  }
  const guideNotifHandlerRef = useRef(onGuideNotification)
  guideNotifHandlerRef.current = onGuideNotification

  useEventStream({
    channels: ['guide:', 'presence:'],
    // Always-on so guests get an SSE session id minted at app boot —
    // without this, guests never open an EventSource and the rt POST flow
    // hangs on waitForSseSession.
    enabled: true,
    onEvent: (channel, payload) => {
      if (channel === 'guide:notification') {
        guideNotifHandlerRef.current?.(payload)
        return
      }
      if (channel === 'guide:journeyStep') {
        useGuideStore.getState().applyJourneyStep({ completedSteps: payload?.completedSteps })
        useGuideStore.getState().open()
        return
      }
      if (channel === 'presence:changed') {
        refreshOnlineFromRest()
      }
    },
  })

  // ── Heartbeat: keep the user marked online on the backend ──────────────────
  useHeartbeat({ enabled: !!user?.id })

  // ── Initial + periodic /presence/online reconcile ──────────────────────────
  // Refetched on presence:changed hints (above) and on tab-become-visible.
  // 60s backstop poll catches membership changes on the rare path where a hint
  // is missed.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    async function refresh() {
      if (cancelled) return
      try {
        const r = await fetch('/api/v1/presence/online', { credentials: 'include' })
        if (!r.ok) return
        const { users } = await r.json()
        useGuideStore.getState().setOnlineUsers(users ?? [])
      } catch {}
    }
    // Exposed so the SSE handler above can trigger refetches on presence events.
    refreshOnlineFromRestRef.current = refresh
    refresh()
    const timer = setInterval(refresh, 60_000)
    const onVis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVis)
      refreshOnlineFromRestRef.current = null
    }
  }, [user?.id])

  // ── Bootstrap undelivered notifications on sign-in ─────────────────────────
  // SSE delivers live events, but a user signing in after being offline needs
  // to catch up on queued UserNotification rows older than the Redis stream's
  // 5-min replay horizon. One-shot REST fetch on sign-in, then POST-deliver.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const token = await getToken()
        if (!token || cancelled) return
        const res = await fetch('/api/v1/users/me/notifications', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok || cancelled) return
        const { notifications } = await res.json()
        if (!Array.isArray(notifications) || notifications.length === 0) return
        const handler = guideNotifHandlerRef.current
        for (const n of notifications) {
          handler?.({ type: n.type, payload: n.payload ?? {}, expiresAt: n.expiresAt })
        }
        await fetch('/api/v1/users/me/notifications/deliver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ids: notifications.map(n => n.id) }),
        }).catch(() => {})
      } catch {}
    })()
    return () => { cancelled = true }
  }, [user?.id])

  async function handleSignOut() {
    await signOut()
    clearSessionCache()
    clearTokenCache()
    // Force useOptimisticSession to re-check — clearing localStorage alone
    // doesn't update the hook's React state, so the UI would keep showing
    // the signed-in avatar/menu until the next 60s poll or a page refresh.
    triggerSessionRefresh()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden" style={{ backgroundColor: 'var(--bg-page)' }}>

      {/* Colosseum background — aiarena platform visual identity */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none select-none"
        style={{
          zIndex: 0,
          opacity: 'var(--photo-opacity)',
          backgroundImage: 'url(/colosseum-bg.jpg)',
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center 40%',
        }}
      />

      {/* ── Primary nav ──────────────────────────────────────── */}
      <AppNav
        appId="landing"
        appUrls={APP_URLS}
        rightSlot={
          <div className="flex items-center gap-2">
            {user && <GuideOrb />}
            {!isPending && !user && (
              <button onClick={() => setShowSignIn(true)} className="btn btn-primary btn-sm">
                Sign in
              </button>
            )}
            {user && (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(o => !o)}
                  className="flex items-center gap-2 px-2 py-1 rounded-lg text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: 'var(--color-teal-600)' }}>
                    {(user.name ?? user.email ?? '?')[0].toUpperCase()}
                  </span>
                  <span className="hidden sm:inline max-w-28 truncate">{user.name ?? user.email}</span>
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 rounded-xl border py-1 z-50"
                    style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}>
                    <Link to="/profile" className="block px-4 py-2 text-sm no-underline hover:bg-[var(--bg-surface-hover)] transition-colors"
                      style={{ color: 'var(--text-primary)' }} onClick={() => setUserMenuOpen(false)}>
                      My Profile
                    </Link>
                    <Link to="/settings" className="block px-4 py-2 text-sm no-underline hover:bg-[var(--bg-surface-hover)] transition-colors"
                      style={{ color: 'var(--text-primary)' }} onClick={() => setUserMenuOpen(false)}>
                      Settings
                    </Link>
                    {user?.role === 'admin' && (
                      <Link to="/admin" className="block px-4 py-2 text-sm no-underline hover:bg-[var(--bg-surface-hover)] transition-colors"
                        style={{ color: 'var(--color-amber-700)' }} onClick={() => setUserMenuOpen(false)}>
                        Admin
                      </Link>
                    )}
                    <hr style={{ borderColor: 'var(--border-default)' }} className="my-1" />
                    <button
                      onClick={() => { setUserMenuOpen(false); handleSignOut() }}
                      className="w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        }
      />

      {/* ── Email verify soft banner — non-blocking ──────────── */}
      <EmailVerifyBanner />

      {/* ── Admin sub-nav ────────────────────────────────────── */}
      {isAdmin && (
        <nav
          className="flex items-center gap-1 px-4 overflow-x-auto"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-default)',
            minHeight: '38px',
          }}
        >
          {[
            { to: '/admin',             label: 'Dashboard'   },
            { to: '/admin/users',       label: 'Users'       },
            { to: '/admin/games',       label: 'Games'       },
            { to: '/admin/tournaments', label: 'Tournaments' },
            { to: '/admin/ml-models',   label: 'ML Models'   },
            { to: '/admin/bots',        label: 'Bots'        },
            { to: '/admin/feedback',    label: 'Feedback'    },
            { to: '/admin/logs',        label: 'Logs'        },
            { to: '/admin/health',      label: 'Health'      },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              className={({ isActive }) =>
                `px-3 py-2 text-xs font-medium whitespace-nowrap no-underline border-b-2 transition-colors ${
                  isActive
                    ? 'border-[var(--color-amber-500)]'
                    : 'border-transparent hover:border-[var(--border-default)]'
                }`
              }
              style={({ isActive }) => ({
                color: isActive ? 'var(--color-amber-700)' : 'var(--text-secondary)',
              })}
            >
              {label}
            </NavLink>
          ))}
        </nav>
      )}

      {/* ── Page content ─────────────────────────────────────── */}
      <main className="flex-1 relative" style={{ zIndex: 1 }}>
        <Outlet />
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer
        className="relative text-center py-6 text-xs"
        style={{ zIndex: 1, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-default)' }}
      >
        © 2026 AI Arena · callidity.com
      </footer>

      <GuidePanel isAdmin={user?.role === 'admin'} />
      {user && <RewardPopup />}
      {user && <CoachingCard />}

      {/* Floating 💬 feedback button + modal. Ported back from the retired
          frontend/ app after Phase 3.0; the Admin inbox was already in landing,
          but the user-facing launcher had been lost in the move. */}
      <FeedbackButton appId="ai-arena" apiBase="/api/v1" hideWhenPlaying />

      {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}

      {/* Audio debug overlay — activated with ?audioDebug=1 (persisted in
          sessionStorage so it survives router-driven URL rewrites). Strip by
          closing the tab or passing ?audioDebug=0. Ships in every build but
          is invisible unless explicitly enabled. */}
      {(() => {
        if (typeof window === 'undefined') return null
        const params = new URLSearchParams(window.location.search)
        const flag = params.get('audioDebug')
        if (flag === '1') sessionStorage.setItem('xo-audio-debug', '1')
        if (flag === '0') sessionStorage.removeItem('xo-audio-debug')
        const on = sessionStorage.getItem('xo-audio-debug') === '1'
        return on ? <AudioDebugOverlay /> : null
      })()}

      {/* Close user dropdown on outside click */}
      {userMenuOpen && (
        <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
      )}
    </div>
  )
}
