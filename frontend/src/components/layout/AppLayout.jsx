import React, { useState, useEffect, useRef } from 'react'
const isStaging = import.meta.env.VITE_ENV === 'staging'
import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { getToken } from '../../lib/getToken.js'
import { api, prefetch } from '../../lib/api.js'
import ThemeToggle from '../ui/ThemeToggle.jsx'
import MuteToggle from '../ui/MuteToggle.jsx'
import AuthModal from '../auth/AuthModal.jsx'
import UserButton from '../auth/UserButton.jsx'
import SignedIn from '../auth/SignedIn.jsx'
import SignedOut from '../auth/SignedOut.jsx'
import { useGameStore } from '../../store/gameStore.js'
import { usePvpStore } from '../../store/pvpStore.js'
import { useRolesStore } from '../../store/rolesStore.js'
import { useSoundStore } from '../../store/soundStore.js'
import FeedbackButton from '../feedback/FeedbackButton.jsx'
import NamePromptModal from '../NamePromptModal.jsx'
import IdleLogoutManager from './IdleLogoutManager.jsx'
import AccomplishmentPopup from '../AccomplishmentPopup.jsx'
import { getSocket } from '../../lib/socket.js'

const BASE = import.meta.env.VITE_API_URL ?? ''

const NAV_LINKS = [
  { to: '/play', label: 'Play' },
  { to: '/gym', label: 'Gym' },
  { to: '/puzzles', label: 'Puzzles' },
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/leaderboard', label: 'Rankings', desktopOnly: true },
]

const BOTTOM_NAV = [
  { to: '/play', label: 'Play', icon: '⊞' },
  { to: '/gym', label: 'Gym', icon: '⚡' },
  { to: '/tournaments', label: 'Tourney', icon: '⊕' },
  { to: '/leaderboard', label: 'Ranks', icon: '★' },
  { to: '/profile', label: 'Profile', icon: '◉' },
]

const MENU_LINKS = [
  { to: '/play',        label: 'Play',         icon: '⊞' },
  { to: '/gym',         label: 'Gym',          icon: '⚡' },
  { to: '/puzzles',     label: 'Puzzles',       icon: '◈' },
  { to: '/tournaments', label: 'Tournaments',   icon: '⊕' },
  { to: '/leaderboard', label: 'Rankings',      icon: '★' },
  { to: '/stats',       label: 'Stats',         icon: '◎' },
  { to: '/profile',     label: 'Profile',       icon: '◉' },
  { to: '/about',       label: 'About',         icon: '○' },
  { to: '/faq',         label: 'FAQ',           icon: '?' },
  { to: '/settings',    label: 'Settings',      icon: '⚙' },
]

const PLATFORM_ADMIN_URL = 'https://aiarena.callidity.com/admin'

// Endpoints/chunks to prefetch when hovering the corresponding nav link.
const PREFETCH_MAP = {
  '/play':        () => prefetch('/bots'),
  '/leaderboard': () => prefetch('/leaderboard?period=all&mode=all&includeBots=false'),
  '/gym':         () => {
    // Preload the Gym's shared helpers + TrainTab (which pulls in vendor-charts)
    import('../gym/gymShared.jsx').catch(() => {})
    import('../gym/TrainTab.jsx').catch(() => {})
  },
}

function usePrefetchHandler(to) {
  const timerRef = React.useRef(null)
  const handler = PREFETCH_MAP[to]
  if (!handler) return {}
  return {
    onMouseEnter: () => { timerRef.current = setTimeout(handler, 80) },
    onMouseLeave: () => { clearTimeout(timerRef.current) },
  }
}

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: session } = useOptimisticSession()
  const isAdmin = session?.user?.role === 'admin'
  const rolesStore = useRolesStore()
  const isSupport = !isAdmin && rolesStore.hasRole('SUPPORT')
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [namePrompt, setNamePrompt] = useState(null) // { userId, currentName } | null
  const [unreadCount, setUnreadCount] = useState(0)
  const [accomplishments, setAccomplishments] = useState([])
  const prevUserId = useRef(null)

  // Close the mobile menu whenever the user navigates
  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  // Fetch roles when user signs in; clear on sign-out
  useEffect(() => {
    const userId = session?.user?.id ?? null
    if (userId && userId !== prevUserId.current) {
      rolesStore.fetch()
      prevUserId.current = userId
    } else if (!userId && prevUserId.current) {
      rolesStore.clear()
      prevUserId.current = null
    }
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll unread-count every 60s to seed the badge on sign-in (no chime — only socket chimes)
  useEffect(() => {
    if (!isAdmin && !isSupport) return
    const endpoint = isAdmin
      ? '/api/v1/admin/feedback/unread-count'
      : '/api/v1/support/feedback/unread-count'
    async function poll() {
      try {
        const token = await getToken()
        const headers = {}
        if (token) headers['Authorization'] = `Bearer ${token}`
        const res = await fetch(`${BASE}${endpoint}`, { headers })
        if (!res.ok) return
        const { count = 0 } = await res.json()
        setUnreadCount(count)
      } catch {}
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => clearInterval(id)
  }, [isAdmin, isSupport]) // eslint-disable-line react-hooks/exhaustive-deps

  // Socket.io feedback:new listener — increments badge and plays chime
  useEffect(() => {
    if (!isAdmin && !isSupport) return
    const socket = getSocket()
    function onFeedbackNew() {
      useSoundStore.getState().play('win')
      setUnreadCount(n => n + 1)
    }
    socket.on('feedback:new', onFeedbackNew)
    return () => { socket.off('feedback:new', onFeedbackNew) }
  }, [isAdmin, isSupport])

  // Clear badge when the user visits their feedback inbox
  useEffect(() => {
    if (isAdmin && location.pathname === '/admin/feedback') setUnreadCount(0)
    if (isSupport && location.pathname === '/support') setUnreadCount(0)
  }, [location.pathname, isAdmin, isSupport])

  // Sync the signed-in user to our DB — once per browser session to avoid a
  // round trip on every page navigation (sessionStorage survives nav, not tab close).
  // Also fetches any pending accomplishment notifications queued while offline.
  useEffect(() => {
    if (!session?.user?.id) return
    if (sessionStorage.getItem('xo_synced') === session.user.id) return
    getToken()
      .then(token => {
        if (!token) return
        return api.users.sync(token).then(({ user }) => {
          sessionStorage.setItem('xo_synced', session.user.id)
          if (user && !user.nameConfirmed) {
            setNamePrompt({ userId: user.id, currentName: user.displayName })
          }
          // Fetch notifications queued while the user was offline
          return api.users.notifications(token).then(({ notifications }) => {
            const pending = (notifications ?? []).filter(n => !n.deliveredAt)
            if (pending.length > 0) setAccomplishments(pending)
          }).catch(() => {})
        })
      })
      .catch(() => {})
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time accomplishment events pushed from the server over Socket.IO
  useEffect(() => {
    const socket = getSocket()
    function onAccomplishment(notif) {
      setAccomplishments(prev => [...prev, notif])
    }
    socket.on('accomplishment', onAccomplishment)
    return () => { socket.off('accomplishment', onAccomplishment) }
  }, [])

  function handleDismissAccomplishment(id) {
    getToken()
      .then(token => api.users.deliverNotifications([id], token))
      .catch(() => {})
    setAccomplishments(prev => prev.filter(n => n.id !== id))
  }

  function handleLogoClick(e) {
    e.preventDefault()
    useGameStore.getState().newGame()
    usePvpStore.getState().reset()
    navigate('/play')
  }

  return (
    <div className="flex flex-col min-h-dvh relative">
      {/* Mountain background — xo.aiarena game site has its own visual identity distinct from the aiarena platform */}
      {/* The Colosseum background applies to aiarena.callidity.com (platform + admin), not the game sites */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none select-none"
        style={{
          zIndex: 0,
          opacity: 'var(--photo-opacity)',
          backgroundImage: 'url(/mountain-bg.jpg)',
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center 30%',
        }}
      />
      {/* Top nav bar */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-3 sm:px-6 md:px-8 h-14 border-b"
        style={{ backgroundColor: isStaging ? '#b45309' : 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
      >
        {/* Logo + Getting Started guide button */}
        <div className="flex items-center gap-2">
          <Link to="/play" onClick={handleLogoClick} className="flex items-center gap-2 select-none no-underline">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="var(--color-blue-600)" />
              <text x="2" y="23" fontSize="19" fontWeight="800" fill="white" fontFamily="var(--font-display), system-ui, sans-serif">X</text>
              <text x="16" y="23" fontSize="19" fontWeight="800" fill="var(--color-teal-500)" fontFamily="var(--font-display), system-ui, sans-serif">O</text>
            </svg>
            <span
              className="text-xl font-bold tracking-tight"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-blue-600)' }}
            >
              XO Arena
            </span>
          </Link>
        </div>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-[var(--color-blue-600)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`
              }
              {...usePrefetchHandler(to)}
            >
              {label}
            </NavLink>
          ))}
          <NavLink
            to="/stats"
            className={({ isActive }) =>
              `text-sm font-medium transition-colors ${
                isActive
                  ? 'text-[var(--color-blue-600)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`
            }
          >
            Stats
          </NavLink>
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              `text-sm font-medium transition-colors ${
                isActive
                  ? 'text-[var(--color-blue-600)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`
            }
          >
            Profile
          </NavLink>
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `text-sm font-medium transition-colors ${
                isActive
                  ? 'text-[var(--color-blue-600)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`
            }
          >
            About
          </NavLink>

          {/* Admin — single link to unified platform admin */}
          {isAdmin && (
            <>
              <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-default)' }} />
              <a
                href={PLATFORM_ADMIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium px-2 py-1 rounded-md transition-colors"
                style={{ color: 'var(--color-amber-600)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--color-amber-50)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                Admin ↗
              </a>
            </>
          )}
        </nav>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <MuteToggle />
          <ThemeToggle />
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Open menu"
            className="md:hidden p-1.5 rounded-lg transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            {menuOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="5" x2="17" y2="5" /><line x1="3" y1="10" x2="17" y2="10" /><line x1="3" y1="15" x2="17" y2="15" />
              </svg>
            )}
          </button>
          <SignedOut>
            <button
              onClick={() => setAuthModalOpen(true)}
              className="text-sm font-medium px-3 py-1.5 rounded-lg transition-all hover:brightness-110 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', color: 'white' }}
            >
              Sign in
            </button>
          </SignedOut>
          <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} />
          <SignedIn>
            <UserButton afterSignOutUrl="/play" />
          </SignedIn>
        </div>
      </header>

      {/* Main content */}
      <main key={location.key} className="xo-page-transition flex-1 px-6 md:px-8 py-6 pb-20 md:pb-6 relative" style={{ zIndex: 1 }}>
        <Outlet />
      </main>

      {/* Mobile hamburger menu drawer */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/50"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          {/* Panel */}
          <div
            className="w-64 h-full flex flex-col overflow-y-auto border-l"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-default)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Menu</span>
              <button
                onClick={() => setMenuOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--bg-surface-hover)]"
                aria-label="Close menu"
                style={{ color: 'var(--text-muted)' }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
                </svg>
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 px-2 py-3 space-y-0.5">
              {MENU_LINKS.map(({ to, label, icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-[var(--color-blue-50)] text-[var(--color-blue-600)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                    }`
                  }
                >
                  <span className="text-base w-5 text-center leading-none">{icon}</span>
                  {label}
                </NavLink>
              ))}

              {/* Admin — single external link to unified platform admin */}
              {isAdmin && (
                <>
                  <div className="my-2 h-px mx-1" style={{ backgroundColor: 'var(--border-default)' }} />
                  <a
                    href={PLATFORM_ADMIN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-[var(--color-amber-50)]"
                    style={{ color: 'var(--color-amber-600)' }}
                  >
                    <span className="text-base w-5 text-center leading-none">⚙</span>
                    Platform Admin ↗
                  </a>
                </>
              )}
            </nav>
          </div>
        </div>
      )}

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {BOTTOM_NAV.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5 transition-colors ${
                isActive
                  ? 'text-[var(--color-blue-600)]'
                  : 'text-[var(--text-secondary)]'
              }`
            }
            {...usePrefetchHandler(to)}
          >
            <span className="text-lg leading-none">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Feedback button — hidden for support users, hidden on mobile during active game */}
      {!isSupport && (
        <FeedbackButton appId="xo-arena" apiBase="/api/v1" hideWhenPlaying />
      )}

      {/* Unread feedback toast for admin/support */}
      {unreadCount > 0 && (isAdmin || isSupport) && (
        <FeedbackToast
          count={unreadCount}
          inboxPath={isAdmin ? '/admin/feedback' : '/support'}
          onDismiss={() => setUnreadCount(0)}
          navigate={navigate}
        />
      )}

      <NamePromptModal
        isOpen={!!namePrompt}
        userId={namePrompt?.userId}
        currentName={namePrompt?.currentName}
        onSave={() => setNamePrompt(null)}
        onSkip={() => setNamePrompt(null)}
      />
      {accomplishments.length > 0 && (
        <AccomplishmentPopup
          notification={accomplishments[0]}
          onDismiss={() => handleDismissAccomplishment(accomplishments[0].id)}
        />
      )}
      <IdleLogoutManager />
    </div>
  )
}

function FeedbackToast({ count, inboxPath, onDismiss, navigate }) {
  return (
    <div
      className="fixed bottom-20 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--color-blue-200)', boxShadow: 'var(--shadow-md)' }}
    >
      <span className="text-lg">💬</span>
      <div>
        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {count} new feedback {count === 1 ? 'item' : 'items'}
        </div>
        <button
          onClick={() => { onDismiss(); navigate(inboxPath) }}
          className="text-xs underline"
          style={{ color: 'var(--color-blue-600)' }}
        >
          View feedback
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="ml-1 p-1 rounded hover:bg-[var(--bg-surface-hover)]"
        style={{ color: 'var(--text-muted)' }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
