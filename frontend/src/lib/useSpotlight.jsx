import { useRef } from 'react'
import { useGuideStore } from '../store/guideStore.js'

/**
 * Returns a ref and a boolean `active` flag.
 * Attach the ref to the element you want to spotlight.
 * When active=true, render <SpotlightRing targetRef={ref} label="..." /> nearby.
 *
 * @param {number} stepIndex  — the journey step this spotlight belongs to
 */
export function useSpotlight(stepIndex) {
  const ref              = useRef(null)
  const journeyProgress  = useGuideStore(s => s.journeyProgress)
  const { completedSteps = [], dismissedAt } = journeyProgress ?? {}

  const active = (
    !dismissedAt &&
    !completedSteps.includes(stepIndex) &&
    // Show only if the previous step is done (or it's step 1)
    (stepIndex === 1 || completedSteps.includes(stepIndex - 1))
  )

  return { ref, active }
}

/**
 * Renders an amber pulsing ring + tooltip around children.
 * Wrap the target element with this component when `active` is true.
 */
export function SpotlightRing({ label, children, active = true }) {
  if (!active) return children
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      {children}
      {/* Pulse ring */}
      <span
        aria-hidden="true"
        className="spotlight-ring"
        style={{
          position: 'absolute', inset: -4,
          borderRadius: 'calc(0.5rem + 4px)',
          border: '2px solid var(--color-amber-500)',
          pointerEvents: 'none', zIndex: 10,
        }}
      />
      {/* Tooltip label */}
      {label && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-amber-500)', color: 'white',
          fontSize: '0.6875rem', fontWeight: 700,
          padding: '0.25rem 0.625rem', borderRadius: '0.375rem',
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 11,
        }}>
          {label}
          <span style={{
            position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)',
            border: '5px solid transparent', borderTopColor: 'var(--color-amber-500)',
          }} />
        </span>
      )}
    </span>
  )
}
