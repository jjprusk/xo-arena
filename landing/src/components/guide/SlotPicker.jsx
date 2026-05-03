// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { useGuideStore } from '../../store/guideStore.js'
import { SLOT_ACTIONS, SLOT_SECTIONS } from './slotActions.js'

/**
 * SlotPicker — modal overlay showing the full action library.
 * Selecting an action appends it to the next empty slot.
 */
export default function SlotPicker({ onClose, isAdmin }) {
  const { slots, updateSlots } = useGuideStore()

  function addAction(action) {
    const alreadyAdded = slots.some(s => (s.actionKey ?? s.key) === action.key)
    if (alreadyAdded) { onClose(); return }
    if (slots.length >= 8) { onClose(); return }
    updateSlots([...slots, { key: action.key, actionKey: action.key, label: action.label, icon: action.icon, href: action.href }])
    onClose()
  }

  const visibleSections = SLOT_SECTIONS.filter(s => s !== 'Admin' || isAdmin)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add a slot action"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onMouseDown={onClose}
    >
      <div
        className="w-full rounded-2xl overflow-hidden"
        style={{
          maxWidth: 340,
          backgroundColor: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-card)',
          border: '1px solid var(--border-default)',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            Add a slot
          </span>
          <button
            onClick={onClose}
            aria-label="Close slot picker"
            className="text-xl leading-none hover:opacity-60 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>

        {/* Action library by section */}
        <div className="p-3 flex flex-col gap-4">
          {visibleSections.map(section => {
            const actions = SLOT_ACTIONS.filter(a => a.section === section)
            return (
              <div key={section}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2 px-1"
                   style={{ color: 'var(--text-muted)' }}>
                  {section}
                </p>
                <div className="flex flex-col gap-1">
                  {actions.map(action => {
                    const added = slots.some(s => (s.actionKey ?? s.key) === action.key)
                    const full  = slots.length >= 8
                    const disabled = added || full
                    return (
                      <button
                        key={action.key}
                        onClick={() => !disabled && addAction(action)}
                        disabled={disabled}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left transition-colors"
                        style={{
                          color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
                          background: 'none',
                          cursor: disabled ? 'default' : 'pointer',
                          opacity: disabled ? 0.5 : 1,
                        }}
                        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'var(--bg-surface-hover)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
                      >
                        <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>
                          {action.icon}
                        </span>
                        <span className="flex-1">{action.label}</span>
                        {action.crossSite && (
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>↗</span>
                        )}
                        {added && (
                          <span style={{ fontSize: 11, color: 'var(--color-teal-500)' }}>✓</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
