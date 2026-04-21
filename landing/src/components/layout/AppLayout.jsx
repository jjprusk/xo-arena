// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useOptimisticSession, clearSessionCache, triggerSessionRefresh } from '../../lib/useOptimisticSession.js'
import { signOut } from '../../lib/auth-client.js'
import { getToken, clearTokenCache } from '../../lib/getToken.js'
import { getSocket, connectSocket, disconnectSocket } from '../../lib/socket.js'
import { perfMark } from '../../lib/perfLog.js'
import SignInModal from '../ui/SignInModal.jsx'
import GuestWelcomeModal from '../ui/GuestWelcomeModal.jsx'
import GuideOrb from '../guide/GuideOrb.jsx'
import GuidePanel from '../guide/GuidePanel.jsx'
import { useGuideStore } from '../../store/guideStore.js'
import { useNotifSoundStore } from '../../store/notifSoundStore.js'
import { useJourneyAutoOpen } from '../../lib/useJourneyAutoOpen.js'
import { useEventStream, isTier2SseEnabled } from '../../lib/useEventStream.js'
import { useHeartbeat } from '../../lib/useHeartbeat.js'
import { JOURNEY_DEFAULT_SLOTS } from '../guide/slotActions.js'
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
  // Tracks the DB userId confirmed by the server after user:subscribe.
  // Used to detect when the server dropped us from the online list.
  const myPresenceIdRef = useRef(null)

  // Mirror of session?.user?.id (the betterAuthId) so the long-lived
  // guide:notification listener — registered once on mount — can filter
  // stakeholder-scoped events (player.joined / player.left) against the
  // CURRENT user without re-registering on every sign-in/out.
  const myBaIdRef = useRef(null)
  useEffect(() => { myBaIdRef.current = user?.id ?? null }, [user?.id])

  // Guest welcome modal — shown once to non-authenticated first-time visitors
  const [guestWelcomeOpen, setGuestWelcomeOpen] = useState(false)
  useEffect(() => {
    if (isPending) return
    if (user) return
    if (localStorage.getItem('aiarena_guest_welcome_seen')) return
    setGuestWelcomeOpen(true)
  }, [isPending, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function closeGuestWelcome() {
    localStorage.setItem('aiarena_guest_welcome_seen', '1')
    setGuestWelcomeOpen(false)
  }

  function openSignInFromWelcome() {
    localStorage.setItem('aiarena_guest_welcome_seen', '1')
    setGuestWelcomeOpen(false)
    setShowSignIn(true)
  }

  useJourneyAutoOpen(user?.id ?? null)

  // Close user dropdown and guide panel whenever the user navigates
  useEffect(() => {
    setUserMenuOpen(false)
    useGuideStore.getState().close()
  }, [location.pathname])

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
          if (!dismissedAt && completedSteps.length < JOURNEY_DEFAULT_SLOTS.length) {
            useGuideStore.getState().open()
          }
        })
      }
      // Connect socket and explicitly subscribe — covers the case where the socket
      // was already connected (so 'connect' won't fire) or reconnects mid-await.
      getToken().then(token => {
        perfMark('AppLayout:token-resolved', token ? 'ok' : 'null')
        if (!token) return
        const socket = connectSocket(token)
        if (socket.connected) {
          perfMark('AppLayout:socket-already-connected')
          socket.emit('user:subscribe', { authToken: token })
        } else {
          socket.once('connect', () => perfMark('AppLayout:socket-connected'))
        }
      }).catch(() => {})
    } else {
      useGuideStore.getState().reset()
    }
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Holds the guide-notification handler so both the socket path and the
  // Tier 2 SSE hook (below) can invoke the same logic. Declared here so the
  // useEffect below can write into it.
  const guideNotifHandlerRef      = useRef(null)
  // Set by the presence effect below; called from the SSE 'presence:changed'
  // handler to trigger a REST refetch.
  const refreshOnlineFromRestRef  = useRef(null)
  function refreshOnlineFromRest() { refreshOnlineFromRestRef.current?.() }

  // Socket guide listeners — registered once on mount.
  // The 'connect' handler fires on EVERY connect/reconnect, ensuring user:subscribe
  // is re-sent after backend restarts without needing a page reload.
  useEffect(() => {
    const socket = getSocket()

    async function onConnect() {
      const token = await getToken()
      if (token) socket.emit('user:subscribe', { authToken: token })
    }
    function onGuideNotification({ type, payload = {}, expiresAt = null }) {
      // When a game starts, the "took a seat" notifications for that table are
      // stale — the game is underway so the seat context is already obvious.
      // Dismiss them before the player finishes their game and opens the Guide.
      if (type === 'table.started' && payload?.tableId) {
        useGuideStore.getState().dismissNotificationsForTable(payload.tableId)
        return
      }
      // Stakeholder filter for seat-change events. These broadcast to every
      // connected client (list page + detail page seat strips need to react),
      // but the notification drawer should only surface them for users who
      // actually care — the table's creator or anyone currently seated. The
      // actor themselves is excluded (they just performed the action).
      if (type === 'player.joined' || type === 'player.left') {
        const myBaId = myBaIdRef.current
        if (!myBaId) return                                    // guest / not signed in
        if (payload.userId === myBaId) return                  // self-action
        const stakes = Array.isArray(payload.stakeholders) ? payload.stakeholders : []
        if (!stakes.includes(myBaId)) return                   // not relevant to this user
      }
      const notif = normalizeBusNotification(type, payload, expiresAt)
      // State-nudge events (e.g. table.created, spectator.joined) return
      // null — not user-facing, consumed by pages via their own subscription.
      if (!notif) return
      useGuideStore.getState().addNotification(notif)
      useNotifSoundStore.getState().play()
      if (notif.uiType === 'flash' || notif.uiType === 'match_ready') {
        if (!useGuideStore.getState().panelOpen) useGuideStore.getState().open()
      }
    }
    function onJourneyStep({ completedSteps }) {
      useGuideStore.getState().applyJourneyStep({ completedSteps })
      useGuideStore.getState().open()
    }

    // Server confirms our presence DB userId — store it so we can detect self-removal.
    function onSubscribed({ userId }) {
      myPresenceIdRef.current = userId
    }

    function onOnlineUsers({ users }) {
      useGuideStore.getState().setOnlineUsers(users)
      // If the server no longer has us in the broadcast, re-subscribe immediately.
      // This self-heals any silent presence drop without requiring a page refresh.
      const myId = myPresenceIdRef.current
      if (myId && socket.connected && !users.some(u => u.userId === myId)) {
        getToken().then(token => {
          if (token) socket.emit('user:subscribe', { authToken: token })
        }).catch(() => {})
      }
    }

    socket.on('connect',            onConnect)
    socket.on('guide:subscribed',   onSubscribed)
    // When Tier 2 SSE is enabled, notifications arrive via SSE instead —
    // skip the socket handler to avoid double-delivery.
    if (!isTier2SseEnabled()) {
      socket.on('guide:notification', onGuideNotification)
    }
    socket.on('guide:journeyStep',  onJourneyStep)
    // Online users: under the SSE flag, presence is driven by heartbeats +
    // /presence/online fetches (see useHeartbeat + the useEventStream hook
    // below). Skip the socket broadcast in that mode to avoid thrashing
    // setOnlineUsers from two competing sources.
    if (!isTier2SseEnabled()) {
      socket.on('guide:onlineUsers',  onOnlineUsers)
    }

    // If already connected when this effect runs, subscribe immediately
    if (socket.connected) onConnect()

    // Presence keepalive — fallback re-subscribe in case no broadcast arrives
    // for an extended period (e.g. no other users connecting or disconnecting).
    const keepalive = setInterval(async () => {
      if (!socket.connected) return
      const token = await getToken()
      if (token) socket.emit('user:subscribe', { authToken: token })
    }, 3 * 60_000)

    // Expose the handler so the SSE hook below can call it with the same logic.
    guideNotifHandlerRef.current = onGuideNotification

    return () => {
      clearInterval(keepalive)
      socket.off('connect',            onConnect)
      socket.off('guide:subscribed',   onSubscribed)
      socket.off('guide:notification', onGuideNotification)
      socket.off('guide:journeyStep',  onJourneyStep)
      socket.off('guide:onlineUsers',  onOnlineUsers)
      guideNotifHandlerRef.current = null
    }
  }, [])

  // ── Tier 2 SSE subscription for guide notifications + presence ─────────────
  // Uses the same notification handler function as the socket path, so sound,
  // filtering, and panel-open logic behave identically. Presence membership
  // changes trigger a REST refetch — state always derives from /presence/online
  // rather than from socket payloads.
  useEventStream({
    channels: ['guide:', 'presence:'],
    enabled: isTier2SseEnabled() && !!user?.id,
    onEvent: (channel, payload) => {
      if (channel === 'guide:notification') {
        const handler = guideNotifHandlerRef.current
        if (handler) handler(payload)
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
  // Runs when signed in under the SSE flag. Refetched on presence:changed
  // hints (above) and on tab-become-visible. Backstop poll at 60s catches
  // membership changes on the rare path where an SSE hint is missed.
  useEffect(() => {
    if (!isTier2SseEnabled()) return
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

  async function handleSignOut() {
    await signOut()
    clearSessionCache()
    clearTokenCache()
    disconnectSocket()
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
        subnav={null}
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

      <GuestWelcomeModal
        isOpen={guestWelcomeOpen}
        onClose={closeGuestWelcome}
        onSignIn={openSignInFromWelcome}
      />
      {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}

      {/* Close user dropdown on outside click */}
      {userMenuOpen && (
        <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} />
      )}
    </div>
  )
}
