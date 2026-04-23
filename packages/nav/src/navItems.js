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
  { key: 'gym',         label: 'Gym',         app: 'landing', to: '/gym'         },
  { key: 'rankings',    label: 'Rankings',    app: 'landing', to: '/rankings'    },
  { key: 'profile',     label: 'Profile',     app: 'landing', to: '/profile'     },
  { key: 'about',       label: 'About',       app: 'landing', to: '/about'       },
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
