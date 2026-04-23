// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { PRIMARY_NAV, resolveItem } from './navItems.js'

/**
 * Shared primary navigation bar for the AI Arena platform.
 *
 * Props:
 *   appId           'landing' | 'xo'  — which site is rendering this nav
 *   appUrls         { landing, xo }   — base URLs for cross-site links
 *   desktopNavKeys  string[] | null   — if provided, only these keys appear in the desktop
 *                                       primary nav (all keys still appear in the hamburger)
 *   rightSlot       ReactNode         — right-side controls (user button, sign-in)
 *   extrasSlot      ReactNode         — extra controls before rightSlot (mute, theme toggles)
 *   isStaging       bool              — amber header background for staging
 */
export default function AppNav({ appId, appUrls, desktopNavKeys, rightSlot, extrasSlot, isStaging }) {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)

  // Close mobile drawer on route change
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Desktop primary nav: optionally filtered by desktopNavKeys
  const desktopPrimaryNav = desktopNavKeys
    ? PRIMARY_NAV.filter(item => desktopNavKeys.includes(item.key))
    : PRIMARY_NAV

  // Mobile drawer shows the full primary nav (plus an optional label section).
  const drawerSections = [{ title: 'AI Arena', items: PRIMARY_NAV }]

  function DesktopNavItem({ item }) {
    const { href, internal } = resolveItem(item, appId, appUrls)
    const cls = ({ isActive }) =>
      `text-sm font-medium transition-colors no-underline ${
        isActive ? 'text-[var(--color-blue-600)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`
    if (internal) return <NavLink to={href} className={cls}>{item.label}</NavLink>
    return (
      <a href={href} className="text-sm font-medium transition-colors no-underline text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        {item.label}
      </a>
    )
  }

  return (
    <>
      {/* ── Primary header ────────────────────────── */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-3 sm:px-6 h-14 border-b"
        style={{
          backgroundColor: isStaging ? '#b45309' : 'var(--bg-surface)',
          borderColor: 'var(--border-default)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          {appId === 'landing' ? (
            <Link to="/" className="flex items-center gap-2 font-bold text-base no-underline select-none"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-slate-500)' }}>
              <span className="text-lg">⚔</span>
              <span>AI Arena</span>
            </Link>
          ) : (
            <a href={appUrls.landing} className="flex items-center gap-2 font-bold text-base no-underline select-none"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-slate-500)' }}>
              <span className="text-lg">⚔</span>
              <span className="hidden sm:inline">AI Arena</span>
            </a>
          )}
        </div>

        {/* Desktop primary nav */}
        <nav className="hidden md:flex items-center gap-5">
          {desktopPrimaryNav.map(item => (
            <DesktopNavItem key={item.key} item={item} />
          ))}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-2 shrink-0">
          {extrasSlot}
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
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
          {rightSlot}
        </div>
      </header>

      {/* ── Mobile drawer ─────────────────────────── */}
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div
            className="w-64 h-full flex flex-col overflow-y-auto border-l"
            style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-md)' }}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border-default)' }}>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Menu</span>
              <button onClick={() => setMenuOpen(false)} className="p-1 rounded-lg hover:bg-[var(--bg-surface-hover)]"
                aria-label="Close menu" style={{ color: 'var(--text-muted)' }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
                </svg>
              </button>
            </div>

            {/* Sections */}
            <nav className="flex-1 px-2 py-3">
              {drawerSections.map((section, si) => (
                <div key={section.title} className={si > 0 ? 'mt-3' : ''}>
                  <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}>
                    {section.title}
                  </div>
                  <div className="space-y-0.5 mt-1">
                    {section.items.map(item => {
                      const { href, internal } = resolveItem(item, appId, appUrls)
                      const cls = 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors no-underline'
                      if (internal) {
                        return (
                          <NavLink key={item.key} to={href} onClick={() => setMenuOpen(false)}
                            className={({ isActive }) =>
                              `${cls} ${isActive
                                ? 'bg-[var(--color-blue-50)] text-[var(--color-blue-600)]'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]'
                              }`
                            }>
                            {item.icon && <span className="text-base w-5 text-center leading-none">{item.icon}</span>}
                            {item.label}
                          </NavLink>
                        )
                      }
                      return (
                        <a key={item.key} href={href}
                          className={`${cls} text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)]`}
                          style={{ display: 'flex' }}>
                          {item.icon && <span className="text-base w-5 text-center leading-none">{item.icon}</span>}
                          {item.label}
                        </a>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
