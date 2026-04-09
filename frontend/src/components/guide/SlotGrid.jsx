import React from 'react'
import { Link } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'
import { getActionByKey, JOURNEY_DEFAULT_SLOTS } from './slotActions.js'

const TOTAL_SLOTS = 8

/**
 * SlotGrid — 4-column grid of up to 8 quick-action slots.
 * Edit mode (toggled via gear icon in GuidePanel header) shows × remove buttons
 * and empty "Add" slots.
 * When the journey is active and no custom slots are set, shows journey steps
 * as default slots with done/current/todo state.
 */
export default function SlotGrid({ editMode, onAddSlot, isAdmin }) {
  const { slots, updateSlots, journeyProgress } = useGuideStore()

  function removeSlot(index) {
    const next = slots.filter((_, i) => i !== index)
    updateSlots(next)
  }

  // Show journey defaults whenever the journey is active (not dismissed),
  // regardless of any stored custom slots — journey guidance takes priority during onboarding
  const { completedSteps = [], dismissedAt } = journeyProgress ?? {}
  const journeyActive = !dismissedAt
  const nextStepIndex = journeyActive
    ? (JOURNEY_DEFAULT_SLOTS.find(s => !completedSteps.includes(s.stepIndex))?.stepIndex ?? null)
    : null

  const cells = journeyActive
    ? Array.from({ length: TOTAL_SLOTS }, (_, i) => {
        const j = JOURNEY_DEFAULT_SLOTS[i]
        return j ? { ...j, _journey: true } : null
      })
    : Array.from({ length: TOTAL_SLOTS }, (_, i) => slots[i] ?? null)

  return (
    <section aria-label="Quick actions">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        {cells.map((slot, i) => {
          if (!slot) {
            // Empty slot
            if (!editMode) return (
              <div
                key={`empty-${i}`}
                style={{
                  aspectRatio: '1',
                  borderRadius: 'var(--radius-md)',
                  border: '1.5px dashed var(--border-default)',
                  opacity: 0.4,
                }}
              />
            )
            return (
              <button
                key={`add-${i}`}
                onClick={onAddSlot}
                aria-label="Add slot"
                style={{
                  aspectRatio: '1',
                  borderRadius: 'var(--radius-md)',
                  border: '1.5px dashed var(--color-slate-400)',
                  background: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  color: 'var(--color-slate-500)',
                  fontSize: 11,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                <span style={{ fontSize: 18 }}>＋</span>
                <span>Add</span>
              </button>
            )
          }

          const action = getActionByKey(slot.actionKey ?? slot.key) ?? slot
          const isExternal = action.crossSite || action.href?.startsWith('http')
          const hasHref = !!action.href

          // Journey state for this cell
          const stepDone    = slot._journey && completedSteps.includes(slot.stepIndex)
          const stepCurrent = slot._journey && slot.stepIndex === nextStepIndex

          const content = (
            <>
              <span style={{ fontSize: 20, lineHeight: 1 }}>{action.icon}</span>
              <span style={{ fontSize: 10, textAlign: 'center', lineHeight: 1.2, wordBreak: 'break-word' }}>
                {action.label}
              </span>
              {isExternal && !editMode && !slot._journey && (
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>↗</span>
              )}
              {/* Journey step badge */}
              {slot._journey && (
                <span style={{
                  position: 'absolute', top: 3, right: 3,
                  width: 13, height: 13, borderRadius: '50%',
                  fontSize: 8, fontWeight: 800, lineHeight: '13px', textAlign: 'center',
                  background: stepDone ? 'var(--color-teal-500)' : stepCurrent ? 'var(--color-amber-500)' : 'rgba(255,255,255,0.12)',
                  color: stepDone || stepCurrent ? 'white' : 'var(--text-muted)',
                }}>
                  {stepDone ? '✓' : slot.stepIndex}
                </span>
              )}
            </>
          )

          const cellStyle = {
            aspectRatio: '1',
            borderRadius: 'var(--radius-md)',
            background: stepDone ? 'rgba(36,181,135,0.08)' : 'var(--bg-surface-2)',
            border: stepCurrent ? '1.5px solid var(--color-amber-500)' : stepDone ? '1px solid rgba(36,181,135,0.3)' : '1px solid var(--border-default)',
            boxShadow: stepCurrent ? '0 0 10px 2px rgba(212,137,30,0.45)' : undefined,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            color: 'var(--text-primary)',
            fontSize: 10,
            fontWeight: 500,
            position: 'relative',
            textDecoration: 'none',
            transition: 'background 0.15s',
            cursor: 'pointer',
            padding: 4,
          }

          return (
            <div key={slot.key ?? i} style={{ position: 'relative' }}>
              {!hasHref || isExternal || editMode ? (
                <div
                  style={{ ...cellStyle, cursor: hasHref && !editMode ? 'pointer' : stepDone ? 'default' : 'pointer' }}
                  onClick={editMode ? undefined : () => { if (isExternal && hasHref) window.open(action.href, '_blank', 'noopener') }}
                  onMouseEnter={e => { if (!editMode && hasHref) e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                  onMouseLeave={e => { if (!editMode && hasHref) e.currentTarget.style.background = stepDone ? 'rgba(36,181,135,0.08)' : 'var(--bg-surface-2)' }}
                >
                  {content}
                </div>
              ) : (
                <Link
                  to={action.href}
                  style={cellStyle}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface-2)' }}
                >
                  {content}
                </Link>
              )}

              {/* Remove button in edit mode */}
              {editMode && (
                <button
                  onClick={() => removeSlot(i)}
                  aria-label={`Remove ${action.label} slot`}
                  className="absolute flex items-center justify-center rounded-full text-white font-bold"
                  style={{
                    top: -6,
                    right: -6,
                    width: 18,
                    height: 18,
                    fontSize: 11,
                    background: 'var(--color-red-500)',
                    border: '2px solid var(--bg-surface)',
                    cursor: 'pointer',
                    zIndex: 5,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
