import React, { useState, useEffect } from 'react'
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useOptimisticSession, clearSessionCache } from '../../lib/useOptimisticSession.js'
import { signOut } from '../../lib/auth-client.js'
import { getToken, clearTokenCache } from '../../lib/getToken.js'
import { getSocket, connectSocket, disconnectSocket } from '../../lib/socket.js'
import SignInModal from '../ui/SignInModal.jsx'
import GuestWelcomeModal from '../ui/GuestWelcomeModal.jsx'
import GuideOrb from '../guide/GuideOrb.jsx'
import GuidePanel from '../guide/GuidePanel.jsx'
import { useGuideStore } from '../../store/guideStore.js'
import { useNotifSoundStore } from '../../store/notifSoundStore.js'
import { useJourneyAutoOpen } from '../../lib/useJourneyAutoOpen.js'

const XO_URL = import.meta.env.VITE_XO_URL ?? 'https://xo-frontend-prod.fly.dev'

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
  const [menuOpen, setMenuOpen] = useState(false)

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

  useJourneyAutoOpen()

  // Close the mobile menu and guide panel whenever the user navigates
  useEffect(() => {
    setMenuOpen(false)
    useGuideStore.getState().close()
  }, [location.pathname])

  // Connect socket and hydrate guide on sign-in; open panel if journey is incomplete; reset on sign-out.
  // Also subscribe the socket to the user's personal room so guide:journeyStep / guide:notification events arrive.
  useEffect(() => {
    if (session?.user?.id) {
      useGuideStore.getState().hydrate().then(() => {
        // Don't auto-open on pages where the guide would obscure gameplay
        if (window.location.pathname.startsWith('/play')) return
        const { journeyProgress } = useGuideStore.getState()
        const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
        if (!dismissedAt && completedSteps.length < 8) {
          useGuideStore.getState().open()
        }
      })
      // Join the user's personal socket room for real-time guide/journey events
      getToken().then(token => {
        if (!token) return
        const socket = connectSocket(token)
        function subscribe() { socket.emit('user:subscribe', { authToken: token }) }
        if (socket.connected) subscribe()
        else socket.once('connect', subscribe)
      }).catch(() => {})
    } else {
      useGuideStore.getState().reset()
    }
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Socket guide listeners
  useEffect(() => {
    const socket = getSocket()
    function onGuideNotification({ type, payload = {}, expiresAt = null }) {
      const notif = normalizeBusNotification(type, payload, expiresAt)
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
    socket.on('guide:notification', onGuideNotification)
    socket.on('guide:journeyStep',  onJourneyStep)
    return () => {
      socket.off('guide:notification', onGuideNotification)
      socket.off('guide:journeyStep',  onJourneyStep)
    }
  }, [])

  async function handleSignOut() {
    await signOut()
    clearSessionCache()
    clearTokenCache()
    disconnectSocket()
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

      {/* ── Nav ──────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-40 flex items-center gap-4 px-4 h-14"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-nav)',
        }}
      >
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2 font-bold text-base no-underline mr-2"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-slate-500)' }}
        >
          <span className="text-lg">⚔</span>
          <span>AI Arena</span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1 flex-1">
          {[
            { to: '/tournaments', label: 'Tournaments' },
            { to: '/faq',         label: 'FAQ'         },
            { to: '/about',       label: 'About'       },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg text-sm font-medium no-underline transition-colors ${
                  isActive
                    ? 'text-white'
                    : 'hover:bg-[var(--bg-surface-hover)]'
                }`
              }
              style={({ isActive }) => isActive
                ? { backgroundColor: 'var(--color-slate-500)', color: 'white' }
                : { color: 'var(--text-secondary)' }
              }
            >
              {label}
            </NavLink>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {user && <GuideOrb />}
          {!isPending && !user && (
            <button
              onClick={() => setShowSignIn(true)}
              className="btn btn-primary btn-sm"
            >
              Sign in
            </button>
          )}

          {user && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg text-sm transition-colors hover:bg-[var(--bg-surface-hover)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ backgroundColor: 'var(--color-teal-600)' }}
                >
                  {(user.name ?? user.email ?? '?')[0].toUpperCase()}
                </span>
                <span className="hidden sm:inline max-w-28 truncate">
                  {user.name ?? user.email}
                </span>
              </button>

              {menuOpen && (
                <div
                  className="absolute right-0 top-full mt-1 w-44 rounded-xl border py-1 z-50"
                  style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
                >
                  <Link
                    to="/profile"
                    className="block px-4 py-2 text-sm no-underline hover:bg-[var(--bg-surface-hover)] transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onClick={() => setMenuOpen(false)}
                  >
                    My Profile
                  </Link>
                  <Link
                    to="/settings"
                    className="block px-4 py-2 text-sm no-underline hover:bg-[var(--bg-surface-hover)] transition-colors"
                    style={{ color: 'var(--text-primary)' }}
                    onClick={() => setMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  {user?.role === 'admin' && (
                    <Link
                      to="/admin"
                      className="block px-4 py-2 text-sm no-underline hover:bg-[var(--bg-surface-hover)] transition-colors"
                      style={{ color: 'var(--color-amber-700)' }}
                      onClick={() => setMenuOpen(false)}
                    >
                      Admin
                    </Link>
                  )}
                  <hr style={{ borderColor: 'var(--border-default)' }} className="my-1" />
                  <button
                    onClick={() => { setMenuOpen(false); handleSignOut() }}
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
      </nav>

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
        style={{ zIndex: 1, color: 'var(--text-muted)', borderTop: '1px solid var(--border-default)' }}
      >
        © 2026 AI Arena · callidity.com
        <span className="mx-2">·</span>
        <a
          href={XO_URL}
          className="no-underline hover:underline"
          style={{ color: 'var(--text-muted)' }}
        >
          XO Arena
        </a>
      </footer>

      <GuidePanel isAdmin={user?.role === 'admin'} />

      <GuestWelcomeModal
        isOpen={guestWelcomeOpen}
        onClose={closeGuestWelcome}
        onSignIn={openSignInFromWelcome}
      />
      {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}

      {/* Close menu on outside click */}
      {menuOpen && (
        <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
      )}
    </div>
  )
}
