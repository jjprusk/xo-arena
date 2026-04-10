import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useGuideStore } from '../store/guideStore.js'

const STEP_ROUTES = {
  7: '/tournaments',
  8: '/tournaments',
}

export function useJourneyAutoOpen() {
  const { pathname } = useLocation()
  const { journeyProgress, panelOpen, open } = useGuideStore()

  useEffect(() => {
    if (panelOpen) return

    const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
    if (dismissedAt) return
    if (completedSteps.length >= 8) return

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
