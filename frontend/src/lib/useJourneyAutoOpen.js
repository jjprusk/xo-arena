import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useGuideStore } from '../store/guideStore.js'
import { useIsInGame } from './useIsInGame.js'

/**
 * Map of step index → route prefix that triggers auto-open.
 * When the user navigates to a matching route and that step is incomplete,
 * the Guide panel opens automatically (unless the user is mid-game).
 */
const STEP_ROUTES = {
  2: '/play',
  3: '/gym/guide',
  4: '/bots',
  5: '/gym',
  6: '/tournaments',
  7: '/tournaments',
}

/**
 * Monitors route changes and auto-opens the Guide panel when the current
 * route matches an incomplete journey step (and the user is not in a game).
 */
export function useJourneyAutoOpen() {
  const { pathname } = useLocation()
  const isInGame     = useIsInGame()
  const { journeyProgress, panelOpen, open } = useGuideStore()

  useEffect(() => {
    if (isInGame) return
    if (panelOpen) return

    const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
    if (dismissedAt) return
    if (completedSteps.length >= 7) return

    for (const [stepStr, route] of Object.entries(STEP_ROUTES)) {
      const step = Number(stepStr)
      if (!completedSteps.includes(step) && pathname.startsWith(route)) {
        open()
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])
}
