import React, { useState, useEffect } from 'react'
const isStaging = import.meta.env.VITE_ENV === 'staging'
import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom'
import { useSession } from '../../lib/auth-client.js'
import { getToken } from '../../lib/getToken.js'
import { api } from '../../lib/api.js'
import ThemeToggle from '../ui/ThemeToggle.jsx'
import MuteToggle from '../ui/MuteToggle.jsx'
import AuthModal from '../auth/AuthModal.jsx'
import UserButton from '../auth/UserButton.jsx'
import SignedIn from '../auth/SignedIn.jsx'
import SignedOut from '../auth/SignedOut.jsx'
import { useGameStore } from '../../store/gameStore.js'
import { usePvpStore } from '../../store/pvpStore.js'

const NAV_LINKS = [
  { to: '/play', label: 'Play' },
  { to: '/ml', label: 'Gym' },
  { to: '/puzzles', label: 'Puzzles' },
  { to: '/leaderboard', label: 'Leaderboard', desktopOnly: true },
]

const BOTTOM_NAV = [
  { to: '/play', label: 'Play', icon: '⊞' },
  { to: '/puzzles', label: 'Puzzles', icon: '◈' },
  { to: '/leaderboard', label: 'Ranks', icon: '★' },
  { to: '/stats', label: 'Stats', icon: '◎' },
  { to: '/profile', label: 'Profile', icon: '◉' },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const { data: session } = useSession()
  const isAdmin = session?.user?.role === 'admin'
  const [authModalOpen, setAuthModalOpen] = useState(false)

  // Sync the signed-in user to our DB — once per browser session to avoid a
  // round trip on every page navigation (sessionStorage survives nav, not tab close).
  useEffect(() => {
    if (!session?.user?.id) return
    if (sessionStorage.getItem('xo_synced') === session.user.id) return
    getToken()
      .then(token => { if (token) return api.users.sync(token) })
      .then(() => { sessionStorage.setItem('xo_synced', session.user.id) })
      .catch(() => {})
  }, [session?.user?.id])

  function handleLogoClick(e) {
    e.preventDefault()
    useGameStore.getState().newGame()
    usePvpStore.getState().reset()
    navigate('/play')
  }

  return (
    <div className="flex flex-col min-h-dvh relative">
      {/* Mountain background */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none select-none"
        style={{
          zIndex: 0,
          opacity: 0.30,
          backgroundImage: 'url(/mountain-bg.jpg)',
          backgroundSize: 'cover',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center center',
        }}
      />
      {/* Top nav bar */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-6 md:px-8 h-14 border-b"
        style={{ backgroundColor: isStaging ? '#b45309' : 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
      >
        {/* Logo */}
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
            to="/settings"
            className={({ isActive }) =>
              `text-sm font-medium transition-colors ${
                isActive
                  ? 'text-[var(--color-blue-600)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`
            }
          >
            Settings
          </NavLink>

          {/* Admin section — amber-tinted, desktop-only, admins only */}
          {isAdmin && (
            <>
              <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-default)' }} />
              {[
                { to: '/admin', label: 'Admin' },
                { to: '/admin/users', label: 'Users' },
                { to: '/admin/ml-models', label: 'Bots' },
                { to: '/admin/ai', label: 'AI' },
                { to: '/admin/logs', label: 'Logs' },
              ].map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/admin'}
                  className={({ isActive }) =>
                    `text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                      isActive
                        ? 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]'
                        : 'text-[var(--color-amber-600)] hover:bg-[var(--color-amber-50)]'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <MuteToggle />
          <ThemeToggle />
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
      <main className="flex-1 px-6 md:px-8 py-6 pb-20 md:pb-6 relative" style={{ zIndex: 1 }}>
        <Outlet />
      </main>

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
          >
            <span className="text-lg leading-none">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
