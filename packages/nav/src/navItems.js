// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Canonical primary navigation for the AI Arena platform.
 * Both the landing site and XO game site share this structure.
 *
 * item.app = 'landing' | 'xo' | null
 * When item.app === appId (the current site), render as <NavLink> (internal routing).
 * Otherwise, build a cross-site <a href> using appUrls[item.app].
 */
// Phase B.1.x of the Bot Challenge & Discovery plan: About moved to the
// footer; Bots takes its primary-nav slot. Bots is high-frequency, action-
// oriented, broad-audience, and onboarding-critical; About is one-time-read.
// Slot count stays at 6 (under the 5-7 soft ceiling).
export const PRIMARY_NAV = [
  { key: 'tables',      label: 'Tables',      app: 'landing', to: '/tables'      },
  { key: 'tournaments', label: 'Tournaments', app: 'landing', to: '/tournaments' },
  { key: 'gym',         label: 'Gym',         app: 'landing', to: '/gym'         },
  { key: 'rankings',    label: 'Rankings',    app: 'landing', to: '/rankings'    },
  { key: 'bots',        label: 'Bots',        app: 'landing', to: '/bots'        },
  { key: 'profile',     label: 'Profile',     app: 'landing', to: '/profile'     },
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
