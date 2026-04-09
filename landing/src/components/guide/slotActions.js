/**
 * slotActions for the landing (aiarena platform) app.
 * xo-arena routes use VITE_XO_URL; platform routes are internal.
 */

const XO = import.meta.env.VITE_XO_URL ?? 'https://xo.aiarena.callidity.com'

export const SLOT_ACTIONS = [
  // Platform (internal)
  { key: 'tournaments',  label: 'Tournaments',    icon: '⊕',  href: '/tournaments',                    section: 'Platform',  crossSite: false },
  // XO Arena (cross-site)
  { key: 'play',         label: 'Play vs Bot',    icon: '⊞',  href: `${XO}/play?action=vs-community-bot`, section: 'XO Arena',  crossSite: true },
  { key: 'faq',          label: 'Read the FAQ',   icon: '❓', href: `${XO}/faq`,                         section: 'XO Arena',  crossSite: true },
  { key: 'gym_guide',    label: 'AI Training',    icon: '📖', href: `${XO}/gym/guide`,                   section: 'XO Arena',  crossSite: true },
  { key: 'gym',          label: 'Train Bot',      icon: '⚡', href: `${XO}/gym?action=start-training`,   section: 'XO Arena',  crossSite: true },
  { key: 'bots',         label: 'My Bots',        icon: '🤖', href: `${XO}/bots`,                        section: 'XO Arena',  crossSite: true },
  { key: 'leaderboard',  label: 'Rankings',       icon: '★',  href: `${XO}/leaderboard`,                 section: 'XO Arena',  crossSite: true },
  { key: 'profile',      label: 'My Profile',     icon: '◉',  href: '/profile',                          section: 'Platform',  crossSite: false },
  // Admin
  { key: 'admin',        label: 'Admin',          icon: '⚙',  href: '/admin',                            section: 'Admin',     crossSite: false },
]

export const SLOT_SECTIONS = ['Platform', 'XO Arena', 'Admin']

export function getActionByKey(key) {
  return SLOT_ACTIONS.find(a => a.key === key) ?? null
}

export const JOURNEY_DEFAULT_SLOTS = [
  { actionKey: null,          stepIndex: 1, label: 'Welcome',     icon: '🎉', href: null },
  { actionKey: 'faq',         stepIndex: 2 },
  { actionKey: 'play',        stepIndex: 3 },
  { actionKey: 'gym_guide',   stepIndex: 4 },
  { actionKey: 'bots',        stepIndex: 5 },
  { actionKey: 'gym',         stepIndex: 6 },
  { actionKey: 'tournaments', stepIndex: 7 },
  { actionKey: 'tournaments', stepIndex: 8 },
]
