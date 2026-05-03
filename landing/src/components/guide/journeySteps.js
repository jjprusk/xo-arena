// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * journeySteps — single source of truth for the 7-step Hook + Curriculum
 * journey on the landing app. Mirrors backend `journeyService.js` STEP_TITLES
 * (titles MUST match exactly so server-emitted progress events line up with
 * the client-rendered checklist).
 *
 * Consumed by JourneyCard (hero/checklist) and SlotGrid (tile grid). Keeping
 * one definition prevents the two surfaces from drifting — see prior incident
 * where SlotGrid still rendered the legacy "Read the FAQ / AI Training / …"
 * tiles after JourneyCard adopted the new STEPS in Sprint 3.
 */

export const JOURNEY_STEPS = [
  { index: 1, title: 'Play a quick game',           shortLabel: 'Quick game', icon: '🎯', cta: 'Play now',             href: '/play?action=vs-community-bot' },
  { index: 2, title: 'Watch two bots battle',       shortLabel: 'Watch demo', icon: '👀', cta: 'Watch a demo',         href: '/play?action=watch-demo'      },
  { index: 3, title: 'Create your first bot',       shortLabel: 'Build bot',  icon: '🤖', cta: 'Build a bot',          href: '/profile?action=quick-bot'    },
  { index: 4, title: 'Train your bot',              shortLabel: 'Train bot',  icon: '🧠', cta: 'Train your bot',       href: '/profile?action=train-bot'    },
  { index: 5, title: 'Spar with your bot',          shortLabel: 'Spar',       icon: '⚔️', cta: 'Spar now',             href: '/profile?action=spar'         },
  { index: 6, title: 'Enter a tournament',          shortLabel: 'Tournament', icon: '🏆', cta: 'Enter Curriculum Cup', href: '/profile?action=cup'          },
  { index: 7, title: "See your bot's first result", shortLabel: 'Result',     icon: '🏅', cta: 'View result',          href: '/profile?action=cup-result'   },
]

export const TOTAL_STEPS            = JOURNEY_STEPS.length
export const HOOK_REWARD_STEP       = 2
export const CURRICULUM_REWARD_STEP = 7

export function deriveCurrentPhase(completedSteps = []) {
  const done = new Set(completedSteps)
  if (done.has(CURRICULUM_REWARD_STEP)) return 'specialize'
  if (done.has(HOOK_REWARD_STEP))       return 'curriculum'
  return 'hook'
}
