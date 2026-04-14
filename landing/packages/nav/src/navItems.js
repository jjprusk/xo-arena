// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Canonical primary navigation for the AI Arena platform.
 * Both the landing site and XO game site share this structure.
 *
 * item.app = 'landing' | 'xo' | null
 * When item.app === appId (the current site), render as <NavLink> (internal routing).
 * Otherwise, build a cross-site <a href> using appUrls[item.app].
 */
export const PRIMARY_NAV = [
  { key: 'tables',      label: 'Tables',      app: 'landing', to: '/tables'      },
  { key: 'tournaments', label: 'Tournaments', app: 'landing', to: '/tournaments' },
  { key: 'rankings',    label: 'Rankings',    app: 'landing', to: '/rankings'    },
  { key: 'profile',     label: 'Profile',     app: 'landing', to: '/profile'     },
  { key: 'about',       label: 'About',       app: 'landing', to: '/about'       },
]

/**
 * Sub-navigation items for the XO game site.
 * All are internal to the XO app (no app field needed — always NavLink when shown).
 */
export const XO_SUBNAV = [
  { key: 'play',    label: 'Play',    to: '/play',    icon: '⊞' },
  { key: 'gym',     label: 'Gym',     to: '/gym',     icon: '⚡' },
  { key: 'puzzles', label: 'Puzzles', to: '/puzzles', icon: '◈' },
  { key: 'stats',   label: 'Stats',   to: '/stats',   icon: '◎' },
]

/**
 * Resolve a nav item to { href, internal }.
 * internal=true  → render as <NavLink> (React Router internal navigation)
 * internal=false → render as <a href> (full page navigation)
 */
export function resolveItem(item, appId, appUrls) {
  if (!item.to) return { href: null, internal: false }
  if (item.app === appId) return { href: item.to, internal: true }
  const baseUrl = appUrls[item.app] ?? ''
  return { href: `${baseUrl}${item.to}`, internal: false }
}
