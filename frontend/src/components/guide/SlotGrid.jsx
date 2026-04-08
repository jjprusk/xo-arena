import React from 'react'
import { Link } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'
import { getActionByKey } from './slotActions.js'

const TOTAL_SLOTS = 8

/**
 * SlotGrid — 4-column grid of up to 8 quick-action slots.
 * Edit mode (toggled via gear icon in GuidePanel header) shows × remove buttons
 * and empty "Add" slots.
 */
export default function SlotGrid({ editMode, onAddSlot, isAdmin }) {
  const { slots, updateSlots } = useGuideStore()

  function removeSlot(index) {
    const next = slots.filter((_, i) => i !== index)
    updateSlots(next)
  }

  const cells = Array.from({ length: TOTAL_SLOTS }, (_, i) => slots[i] ?? null)

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

          const content = (
            <>
              <span style={{ fontSize: 20, lineHeight: 1 }}>{action.icon}</span>
              <span style={{ fontSize: 10, textAlign: 'center', lineHeight: 1.2, wordBreak: 'break-word' }}>
                {action.label}
              </span>
              {isExternal && !editMode && (
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>↗</span>
              )}
            </>
          )

          const cellStyle = {
            aspectRatio: '1',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-surface-2)',
            border: '1px solid var(--border-default)',
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
              {isExternal || editMode ? (
                <div
                  style={cellStyle}
                  onClick={editMode ? undefined : () => { if (isExternal) window.open(action.href, '_blank', 'noopener') }}
                  onMouseEnter={e => { if (!editMode) e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                  onMouseLeave={e => { if (!editMode) e.currentTarget.style.background = 'var(--bg-surface-2)' }}
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
