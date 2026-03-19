import React from 'react'
import { Outlet, NavLink } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react'
import ThemeToggle from '../ui/ThemeToggle.jsx'
import MuteToggle from '../ui/MuteToggle.jsx'

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const NAV_LINKS = [
  { to: '/play', label: 'Play' },
  { to: '/leaderboard', label: 'Leaderboard', desktopOnly: true },
]

const BOTTOM_NAV = [
  { to: '/play', label: 'Play', icon: '⊞' },
  { to: '/stats', label: 'Stats', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function AppLayout() {
  return (
    <div className="flex flex-col min-h-dvh">
      {/* Top nav bar */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 h-14 border-b"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
      >
        {/* Logo */}
        <span
          className="text-xl font-bold tracking-tight select-none"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-blue-600)' }}
        >
          XO Arena
        </span>

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

          {/* Admin section — amber-tinted, desktop-only */}
          <span className="w-px h-4 mx-1" style={{ backgroundColor: 'var(--border-default)' }} />
          <NavLink
            to="/admin/ai"
            className={({ isActive }) =>
              `text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                isActive
                  ? 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]'
                  : 'text-[var(--color-amber-600)] hover:bg-[var(--color-amber-50)]'
              }`
            }
          >
            AI
          </NavLink>
          <NavLink
            to="/admin/logs"
            className={({ isActive }) =>
              `text-xs font-medium px-2 py-1 rounded-md transition-colors ${
                isActive
                  ? 'bg-[var(--color-amber-100)] text-[var(--color-amber-700)]'
                  : 'text-[var(--color-amber-600)] hover:bg-[var(--color-amber-50)]'
              }`
            }
          >
            Logs
          </NavLink>
        </nav>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <MuteToggle />
          <ThemeToggle />
          {CLERK_KEY && (
            <>
              <SignedOut>
                <SignInButton mode="modal">
                  <button
                    className="text-sm font-medium px-3 py-1.5 rounded-lg transition-all hover:brightness-110 active:scale-[0.97]"
                    style={{ background: 'linear-gradient(135deg, var(--color-blue-500), var(--color-blue-700))', color: 'white' }}
                  >
                    Sign in
                  </button>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <UserButton afterSignOutUrl="/play" />
              </SignedIn>
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 py-6 pb-20 md:pb-6">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
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
