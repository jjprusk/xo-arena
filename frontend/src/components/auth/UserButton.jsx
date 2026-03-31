import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from '../../lib/auth-client.js'
import { useOptimisticSession, clearSessionCache } from '../../lib/useOptimisticSession.js'
import { clearTokenCache } from '../../lib/getToken.js'

export default function UserButton({ afterSignOutUrl = '/play' }) {
  const { data: session } = useOptimisticSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const navigate = useNavigate()

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  async function handleSignOut() {
    setOpen(false)
    clearSessionCache()
    clearTokenCache()
    // Clear cached DB user for all users in sessionStorage
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('xo_dbuser_'))
      .forEach(k => sessionStorage.removeItem(k))
    await signOut()
    navigate(afterSignOutUrl)
  }

  const user = session?.user
  const isAdmin = user?.role === 'admin'

  return (
    <div ref={containerRef} className="relative">
      {/* Avatar trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[var(--color-blue-600)]"
        style={{ backgroundColor: 'var(--color-blue-100)', color: 'var(--color-blue-700)' }}
      >
        {user?.image ? (
          <img src={user.image} alt="" className="w-full h-full object-cover" style={{ backgroundColor: 'white' }} />
        ) : (
          user?.name?.[0]?.toUpperCase() || '?'
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          className="absolute right-0 top-10 z-50 min-w-[220px] rounded-xl border shadow-lg overflow-hidden"
          style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)' }}
        >
          {/* User info header */}
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border-default)' }}>
            <div
              className="w-10 h-10 rounded-full overflow-hidden shrink-0 flex items-center justify-center text-sm font-bold"
              style={{ backgroundColor: 'white', border: '1px solid var(--border-default)' }}
            >
              {user?.image ? (
                <img src={user.image} alt="" className="w-full h-full object-cover" />
              ) : (
                <span style={{ color: 'var(--color-blue-700)' }}>{user?.name?.[0]?.toUpperCase() || '?'}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{user?.name}</div>
              <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{user?.email}</div>
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => { setOpen(false); navigate('/profile') }}
              className="w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-[var(--bg-surface-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              Manage account
              <span style={{ color: 'var(--text-muted)' }}>→</span>
            </button>
            <button
              onClick={() => { setOpen(false); navigate('/settings') }}
              className="w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-[var(--bg-surface-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              Settings
              <span style={{ color: 'var(--text-muted)' }}>⚙</span>
            </button>

            {isAdmin && (
              <button
                onClick={() => { setOpen(false); navigate('/admin') }}
                className="w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-[var(--bg-surface-hover)]"
                style={{ color: 'var(--text-primary)' }}
              >
                Admin Panel
                <span>⚙</span>
              </button>
            )}
          </div>

          {/* Sign out */}
          <div style={{ borderTop: '1px solid var(--border-default)' }}>
            <button
              onClick={handleSignOut}
              className="w-full text-left px-4 py-2 text-sm hover:bg-[var(--bg-surface-hover)]"
              style={{ color: 'var(--color-red-600)' }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
