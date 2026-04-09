import React, { useState } from 'react'
import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useOptimisticSession, clearSessionCache } from '../../lib/useOptimisticSession.js'
import { signOut } from '../../lib/auth-client.js'
import { clearTokenCache } from '../../lib/getToken.js'
import SignInModal from '../ui/SignInModal.jsx'

const XO_URL = import.meta.env.VITE_XO_URL ?? 'https://xo.aiarena.callidity.com'

export default function AppLayout() {
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null
  const navigate = useNavigate()
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const [showSignIn, setShowSignIn] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    clearSessionCache()
    clearTokenCache()
    navigate('/')
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg-page)' }}>

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
          <NavLink
            to="/tournaments"
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
            Tournaments
          </NavLink>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
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
                  style={{ backgroundColor: 'var(--color-slate-500)' }}
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
      <main className="flex-1">
        <Outlet />
      </main>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer
        className="text-center py-6 text-xs"
        style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-default)' }}
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

      {showSignIn && <SignInModal onClose={() => setShowSignIn(false)} />}

      {/* Close menu on outside click */}
      {menuOpen && (
        <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
      )}
    </div>
  )
}
