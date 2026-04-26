// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * slotActions for the landing (aiarena platform) app.
 * All routes are now internal — XO features run on landing.
 */

export const SLOT_ACTIONS = [
  // Platform (internal)
  { key: 'tournaments',  label: 'Tournaments',    icon: '⊕',  href: '/tournaments',                       section: 'Platform', crossSite: false },
  { key: 'play',         label: 'Play',           icon: '⊞',  href: '/play?action=vs-community-bot',      section: 'Platform', crossSite: false },
  { key: 'play_my_bot',  label: 'Play vs Bot',    icon: '🎮', href: '/play?action=vs-my-bot',             section: 'Platform', crossSite: false },
  { key: 'journey_complete', label: 'Congrats',   icon: '🏅', href: null,                                 section: 'Platform', crossSite: false },
  { key: 'gym_guide',    label: 'AI Training',    icon: '📖', href: '/gym/guide',                         section: 'Platform', crossSite: false },
  { key: 'gym',          label: 'Train Bot',      icon: '⚡', href: '/gym?action=start-training',         section: 'Platform', crossSite: false },
  { key: 'bots',         label: 'My Bots',        icon: '🤖', href: '/profile?section=bots',              section: 'Platform', crossSite: false },
  { key: 'create_bot',   label: 'Create 1st Bot', icon: '🤖', href: '/profile?action=create-bot',         section: 'Platform', crossSite: false },
  { key: 'profile_bots', label: 'My Bots',        icon: '🤖', href: '/profile?section=bots',              section: 'Platform', crossSite: false },
  { key: 'rankings',     label: 'Rankings',       icon: '★',  href: '/rankings',                          section: 'Platform', crossSite: false },
  { key: 'stats',        label: 'Stats',          icon: '◎',  href: '/stats',                             section: 'Platform', crossSite: false },
  { key: 'puzzles',      label: 'Puzzles',        icon: '◈',  href: '/puzzles',                           section: 'Platform', crossSite: false },
  { key: 'profile',      label: 'My Profile',     icon: '◉',  href: '/profile',                          section: 'Platform',  crossSite: false },
  // Admin
  { key: 'admin',        label: 'Admin',          icon: '⚙',  href: '/admin',                            section: 'Admin',     crossSite: false },
]

export const SLOT_SECTIONS = ['Platform', 'Admin']

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

// Journey tile metadata moved to ./journeySteps.js (single source of truth
// shared with JourneyCard so the two surfaces can't drift).
