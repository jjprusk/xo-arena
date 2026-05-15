// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Admin sub-nav configuration + per-role filtering helper.
 *
 * Sprint 4 §4.0 — carried from §1.8. The sub-nav is grouped into
 * three sections (Platform / Operations / Content) and links are
 * filtered by the calling user's domain roles. ADMIN (BA-side or
 * domain-side) sees everything; the narrower roles see only their
 * own slice so a TOURNAMENT_ADMIN doesn't accidentally land on
 * pages they can't act on.
 *
 * `isBaAdmin` is the BetterAuth role flag (legacy "admin" string).
 * `domainRoles` is the array returned by GET /api/v1/me/roles.
 */

/**
 * Sections in render order. Each section has a label and an array
 * of links; each link declares which roles can see it.
 */
export const ADMIN_NAV_SECTIONS = [
  {
    id:    'platform',
    label: 'Platform',
    links: [
      { to: '/admin',             label: 'Dashboard', roles: ['ADMIN']                                                    },
      { to: '/admin/users',       label: 'Users',     roles: ['ADMIN']                                                    },
    ],
  },
  {
    id:    'operations',
    label: 'Operations',
    links: [
      { to: '/admin/games',       label: 'Games',       roles: ['ADMIN']                                                  },
      { to: '/admin/tournaments', label: 'Tournaments', roles: ['ADMIN', 'TOURNAMENT_ADMIN']                               },
      { to: '/admin/ml-models',   label: 'ML Models',   roles: ['ADMIN', 'BOT_ADMIN']                                      },
      { to: '/admin/bots',        label: 'Bots',        roles: ['ADMIN', 'BOT_ADMIN']                                      },
      { to: '/admin/feedback',    label: 'Feedback',    roles: ['ADMIN', 'SUPPORT']                                        },
      { to: '/admin/logs',        label: 'Logs',        roles: ['ADMIN']                                                  },
      { to: '/admin/health',      label: 'Health',      roles: ['ADMIN']                                                  },
    ],
  },
  {
    id:    'content',
    label: 'Content',
    links: [
      { to: '/admin/help',         label: 'Help',    roles: ['ADMIN', 'HELP_ADMIN'] },
      { to: '/admin/help/queries', label: 'Queue',   roles: ['ADMIN', 'HELP_ADMIN'] },
      { to: '/admin/help/metrics', label: 'Metrics', roles: ['ADMIN', 'HELP_ADMIN'] },
    ],
  },
]

/**
 * Returns the visible sections for the given role set, with each
 * section's `links` filtered to the ones the user is gated for.
 * Empty sections are omitted so we don't render a label with no
 * children.
 *
 * @param {Object}  opts
 * @param {boolean} opts.isBaAdmin    — BA-side `user.role === 'admin'`.
 * @param {Array}   opts.domainRoles  — Array of strings from /me/roles.
 * @returns {Array} Same shape as ADMIN_NAV_SECTIONS but filtered.
 */
export function filterNavForRoles({ isBaAdmin, domainRoles }) {
  const roles = new Set(Array.isArray(domainRoles) ? domainRoles : [])
  // BA admins are equivalent to domain ADMIN for visibility purposes.
  if (isBaAdmin) roles.add('ADMIN')

  return ADMIN_NAV_SECTIONS
    .map(section => ({
      ...section,
      links: section.links.filter(link =>
        link.roles.some(r => roles.has(r))
      ),
    }))
    .filter(section => section.links.length > 0)
}
