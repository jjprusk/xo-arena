/**
 * slotActions for the landing (aiarena platform) app.
 * xo-arena routes use VITE_XO_URL; platform routes are internal.
 */

const XO = import.meta.env.VITE_XO_URL ?? 'https://xo-frontend-prod.fly.dev'

export const SLOT_ACTIONS = [
  // Platform (internal)
  { key: 'tournaments',  label: 'Tournaments',    icon: '⊕',  href: '/tournaments',                    section: 'Platform',  crossSite: false },
  // XO Arena (cross-site)
  { key: 'play',         label: 'Play',        icon: '⊞',  href: `${XO}/play?action=vs-community-bot`, section: 'XO Arena',  crossSite: true },
  { key: 'play_my_bot',      label: 'Play vs Bot', icon: '🎮', href: `${XO}/play?action=vs-my-bot`, section: 'XO Arena',  crossSite: true },
  { key: 'journey_complete', label: 'Congrats',    icon: '🏅', href: null,                           section: 'Platform',  crossSite: false },
  { key: 'faq',          label: 'Read the FAQ',   icon: '❓', href: '/faq',                              section: 'Platform',  crossSite: false },
  { key: 'gym_guide',    label: 'AI Training',    icon: '📖', href: `${XO}/gym/guide`,                   section: 'XO Arena',  crossSite: true },
  { key: 'gym',          label: 'Train Bot',      icon: '⚡', href: `${XO}/gym?action=start-training`,   section: 'XO Arena',  crossSite: true },
  { key: 'bots',         label: 'My Bots',        icon: '🤖', href: `${XO}/bots`,                        section: 'XO Arena',  crossSite: true },
  { key: 'create_bot',   label: 'Create 1st Bot', icon: '🤖', href: '/profile?action=create-bot',        section: 'Platform',  crossSite: false },
  { key: 'profile_bots', label: 'My Bots',        icon: '🤖', href: '/profile?section=bots',             section: 'Platform',  crossSite: false },
  { key: 'rankings',     label: 'Rankings',       icon: '★',  href: `${XO}/leaderboard`,                 section: 'XO Arena',  crossSite: true },
  { key: 'stats',        label: 'Stats',          icon: '◎',  href: `${XO}/stats`,                       section: 'XO Arena',  crossSite: true },
  { key: 'puzzles',      label: 'Puzzles',        icon: '◈',  href: `${XO}/puzzles`,                     section: 'XO Arena',  crossSite: true },
  { key: 'profile',      label: 'My Profile',     icon: '◉',  href: '/profile',                          section: 'Platform',  crossSite: false },
  // Admin
  { key: 'admin',        label: 'Admin',          icon: '⚙',  href: '/admin',                            section: 'Admin',     crossSite: false },
]

export const SLOT_SECTIONS = ['Platform', 'XO Arena', 'Admin']

export function getActionByKey(key) {
  return SLOT_ACTIONS.find(a => a.key === key) ?? null
}

/**
 * Default slots shown after the journey is dismissed (post-onboarding).
 */
export const POST_JOURNEY_SLOTS = [
  { actionKey: 'play' },
  { actionKey: 'gym' },
  { actionKey: 'gym_guide' },
  { actionKey: 'profile_bots' },
  { actionKey: 'rankings' },
  { actionKey: 'tournaments' },
  { actionKey: 'stats' },
  { actionKey: 'puzzles' },
]

export const JOURNEY_DEFAULT_SLOTS = [
  { actionKey: null,          stepIndex: 1, label: 'Welcome',     icon: '🎉', href: null },
  { actionKey: 'faq',         stepIndex: 2 },
  { actionKey: 'play',        stepIndex: 3 },
  { actionKey: 'gym_guide',   stepIndex: 4 },
  { actionKey: 'create_bot',  stepIndex: 5 },
  { actionKey: 'gym',         stepIndex: 6 },
  { actionKey: 'play_my_bot',  stepIndex: 7 },
  { actionKey: 'journey_complete', stepIndex: 8 },
]
