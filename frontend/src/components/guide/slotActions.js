/**
 * Master action library for Guide slots.
 * Each action has: key, label, icon, href, section, crossSite
 */

export const SLOT_ACTIONS = [
  // Platform
  { key: 'play',            label: 'Play vs Bot',        icon: '⊞',  href: '/play?action=vs-community-bot', section: 'Platform',  crossSite: false },
  { key: 'faq',             label: 'Read the FAQ',       icon: '❓', href: '/faq',                          section: 'Platform',  crossSite: false },
  { key: 'find_room',       label: 'Find a Room',        icon: '🔗', href: '/play',                         section: 'Platform',  crossSite: false },
  { key: 'tournaments',     label: 'Tournaments',        icon: '⊕',  href: `${import.meta.env.VITE_PLATFORM_URL ?? 'https://aiarena.callidity.com'}/tournaments`, section: 'Platform',  crossSite: true },
  { key: 'rankings',        label: 'Rankings',           icon: '★',  href: '/leaderboard',                  section: 'Platform',  crossSite: false },
  { key: 'profile',         label: 'My Profile',         icon: '◉',  href: '/profile',                      section: 'Platform',  crossSite: false },
  { key: 'stats',           label: 'Stats',              icon: '◎',  href: '/stats',                        section: 'Platform',  crossSite: false },
  // XO Arena
  { key: 'gym',             label: 'Start Training',     icon: '⚡', href: '/gym?action=start-training',    section: 'XO Arena',  crossSite: false },
  { key: 'puzzles',         label: 'Puzzles',            icon: '◈',  href: '/puzzles',                      section: 'XO Arena',  crossSite: false },
  { key: 'create_room',     label: 'Create Room',        icon: '➕', href: '/play',                         section: 'XO Arena',  crossSite: false },
  { key: 'watch_live',      label: 'Watch Live',         icon: '👁',  href: '/leaderboard',                  section: 'XO Arena',  crossSite: false },
  { key: 'gym_guide',       label: 'AI Training Guide',  icon: '📖', href: '/gym/guide',                    section: 'XO Arena',  crossSite: false },
  // Admin (shown only to admins — filtered by caller)
  { key: 'admin_panel',     label: 'Admin Panel',        icon: '⚙',  href: 'https://aiarena.callidity.com/admin', section: 'Admin', crossSite: true },
]

export const SLOT_SECTIONS = ['Platform', 'XO Arena', 'Admin']

export function getActionByKey(key) {
  return SLOT_ACTIONS.find(a => a.key === key) ?? null
}

/**
 * Default slots shown during active onboarding (journey not dismissed, no custom slots set).
 * Each entry maps a slot action key to the journey step it represents.
 */
export const JOURNEY_DEFAULT_SLOTS = [
  { actionKey: null,          stepIndex: 1, label: 'Welcome',     icon: '🎉', href: null },
  { actionKey: 'faq',         stepIndex: 2 },
  { actionKey: 'play',        stepIndex: 3 },
  { actionKey: 'gym_guide',   stepIndex: 4 },
  { actionKey: 'profile',     stepIndex: 5 },
  { actionKey: 'gym',         stepIndex: 6 },
  { actionKey: 'tournaments', stepIndex: 7 },
  { actionKey: 'tournaments', stepIndex: 8 },
]
