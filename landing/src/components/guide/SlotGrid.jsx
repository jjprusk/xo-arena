// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'
import { getActionByKey } from './slotActions.js'
import { JOURNEY_STEPS } from './journeySteps.js'

const TOTAL_SLOTS = 8  // post-journey slot count (POST_JOURNEY_SLOTS has 8 entries)

export default function SlotGrid({ editMode, onAddSlot, isAdmin, onSlotAction }) {
  const { slots, updateSlots, journeyProgress, close } = useGuideStore()

  const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
  const journeyActive = !dismissedAt
  const nextStepIndex = journeyActive
    ? (JOURNEY_STEPS.find(s => !completedSteps.includes(s.index))?.index ?? null)
    : null

  // Computed once on mount — prevents a reactive feedback loop where setUiHint
  // immediately flips the pointer flag to false before the finger ever paints.
  // The pointer guides the user to whichever step is next when the panel first
  // opens; once seen (persisted via setUiHint) it does not re-appear.
  const [showPointerOnce] = useState(() => {
    const store = useGuideStore.getState()
    if (store.uiHints?.journeyPointerShown) return false
    return nextStepIndex !== null
  })

  useEffect(() => {
    if (showPointerOnce) useGuideStore.getState().setUiHint('journeyPointerShown')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function removeSlot(index) {
    const next = slots.filter((_, i) => i !== index)
    updateSlots(next)
  }

  // Journey mode: render exactly the 7 canonical steps from JOURNEY_STEPS.
  // Post-journey: fall back to the user's customizable slot deck.
  const cells = journeyActive
    ? JOURNEY_STEPS.map(step => ({
        _journey:    true,
        stepIndex:   step.index,
        label:       step.shortLabel,
        icon:        step.icon,
        href:        step.href,
        isFinalStep: step.index === JOURNEY_STEPS.length,
      }))
    : Array.from({ length: TOTAL_SLOTS }, (_, i) => slots[i] ?? null)

  return (
    <section aria-label="Quick actions">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, overflow: 'visible' }}>
        {cells.map((slot, i) => {
          if (!slot) {
            if (!editMode) return (
              <div key={`empty-${i}`} style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)', border: '1.5px dashed var(--border-default)', opacity: 0.4 }} />
            )
            return (
              <button key={`add-${i}`} onClick={onAddSlot} aria-label="Add slot"
                style={{ aspectRatio: '1', borderRadius: 'var(--radius-md)', border: '1.5px dashed var(--color-slate-400)', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: 'var(--color-slate-500)', fontSize: 11, transition: 'background 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                <span style={{ fontSize: 18 }}>＋</span>
                <span>Add</span>
              </button>
            )
          }

          // Journey tile fields come straight off the slot; post-journey
          // tiles look up their action in SLOT_ACTIONS as before.
          const action = slot._journey
            ? { icon: slot.icon, label: slot.label, href: slot.href, key: null, crossSite: false }
            : (getActionByKey(slot.actionKey ?? slot.key) ?? slot)
          const isExternal = action.crossSite || action.href?.startsWith('http')
          const hasHref = !!action.href

          const stepDone    = slot._journey && completedSteps.includes(slot.stepIndex)
          const stepCurrent = slot._journey && slot.stepIndex === nextStepIndex
          const stepTodo    = slot._journey && !stepDone && !stepCurrent
          const showPointer = showPointerOnce && stepCurrent && !editMode
          // Final journey step: intercept click to show the completion popup
          // instead of navigating directly; GuidePanel navigates after dismissal.
          const isFinalJourneyStep = slot._journey && slot.isFinalStep && stepCurrent

          const content = (
            <>
              <span style={{ fontSize: 20, lineHeight: 1 }}>{action.icon}</span>
              <span style={{ fontSize: 10, textAlign: 'center', lineHeight: 1.2, wordBreak: 'break-word' }}>{action.label}</span>
              {slot._journey && (
                <span style={{ position: 'absolute', top: 3, right: 3, width: 13, height: 13, borderRadius: '50%', fontSize: 8, fontWeight: 800, lineHeight: '13px', textAlign: 'center', background: stepDone ? 'var(--color-teal-500)' : stepCurrent ? 'var(--color-amber-500)' : 'rgba(255,255,255,0.12)', color: stepDone || stepCurrent ? 'white' : 'var(--text-muted)' }}>
                  {stepDone ? '✓' : slot.stepIndex}
                </span>
              )}
            </>
          )

          const cellStyle = {
            aspectRatio: '1', borderRadius: 'var(--radius-md)',
            background: stepDone ? 'rgba(36,181,135,0.08)' : 'var(--bg-surface-2)',
            border: stepCurrent ? '1.5px solid var(--color-amber-500)' : stepDone ? '1px solid rgba(36,181,135,0.3)' : '1px solid var(--border-default)',
            boxShadow: stepCurrent ? '0 0 10px 2px rgba(212,137,30,0.45)' : undefined,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4, color: stepTodo ? 'var(--text-muted)' : 'var(--text-primary)', fontSize: 10, fontWeight: 500,
            position: 'relative', textDecoration: 'none', transition: 'background 0.15s',
            cursor: stepTodo ? 'default' : 'pointer', padding: 4,
            opacity: stepTodo ? 0.45 : 1,
            pointerEvents: stepTodo && !editMode ? 'none' : undefined,
          }

          return (
            <div key={slot.key ?? `journey-${slot.stepIndex ?? i}`} style={{ position: 'relative', overflow: 'visible' }}>
              {/* Animated finger — points from the left at the current step, first open only */}
              {showPointer && (
                <div style={{
                  position: 'absolute',
                  right: '100%',
                  top: '5%',
                  transform: 'translateY(-50%)',
                  zIndex: 20,
                  pointerEvents: 'none',
                  paddingRight: 6,
                  animation: 'tip-bounce 0.9s ease-in-out infinite',
                }}>
                  <div style={{
                    fontSize: 56,
                    lineHeight: 1,
                    background: 'radial-gradient(circle, rgba(212,137,30,0.35) 30%, transparent 72%)',
                    borderRadius: '50%',
                    padding: 10,
                    boxShadow: '0 0 18px 8px rgba(212,137,30,0.45)',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.45))',
                  }}>👉</div>
                </div>
              )}

              {isFinalJourneyStep ? (
                // Final step: trigger journey complete popup instead of navigating directly
                <div
                  style={{ ...cellStyle, cursor: 'pointer' }}
                  onClick={() => { if (onSlotAction) onSlotAction('journey_complete') }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface-2)' }}
                >
                  {content}
                </div>
              ) : !hasHref || isExternal || editMode ? (
                <div
                  style={{ ...cellStyle, cursor: hasHref && !editMode ? 'pointer' : 'default' }}
                  onClick={editMode ? undefined : () => {
                    if (isExternal && hasHref) { close(); window.location.href = action.href }
                    else if (!hasHref && action.key && onSlotAction) { close(); onSlotAction(action.key) }
                  }}
                  onMouseEnter={e => { if (!editMode && hasHref) e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                  onMouseLeave={e => { if (!editMode && hasHref) e.currentTarget.style.background = stepDone ? 'rgba(36,181,135,0.08)' : 'var(--bg-surface-2)' }}
                >
                  {content}
                </div>
              ) : (
                <Link to={action.href} style={cellStyle}
                  onClick={close}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface-2)' }}
                >
                  {content}
                </Link>
              )}
              {editMode && (
                <button onClick={() => removeSlot(i)} aria-label={`Remove ${action.label} slot`}
                  className="absolute flex items-center justify-center rounded-full text-white font-bold"
                  style={{ top: -6, right: -6, width: 18, height: 18, fontSize: 11, background: 'var(--color-red-500)', border: '2px solid var(--bg-surface)', cursor: 'pointer', zIndex: 5 }}
                >×</button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
