import React, { useState, useEffect, useRef } from 'react'
import { useGuideStore } from '../../store/guideStore.js'
import { POST_JOURNEY_SLOTS } from './slotActions.js'
import NotificationStack from './NotificationStack.jsx'
import JourneyCard from './JourneyCard.jsx'
import SlotGrid from './SlotGrid.jsx'
import SlotPicker from './SlotPicker.jsx'
import OnlineStrip from './OnlineStrip.jsx'
import JourneyCompletePopup from '../ui/JourneyCompletePopup.jsx'

/**
 * GuidePanel — slide-in panel from the right.
 * 320px on desktop, full-width bottom-sheet on mobile.
 * Closes on Escape or clicking the backdrop.
 */
function handleJourneyComplete() {
  useGuideStore.getState().completeJourney(POST_JOURNEY_SLOTS)
}

export default function GuidePanel({ isAdmin = false }) {
  const { panelOpen, close } = useGuideStore()
  const [editMode,             setEditMode]             = useState(false)
  const [pickerOpen,           setPickerOpen]           = useState(false)
  const [journeyCompleteOpen,  setJourneyCompleteOpen]  = useState(false)
  const panelRef = useRef(null)

  // Escape key closes panel
  useEffect(() => {
    if (!panelOpen) return
    function onKey(e) { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelOpen, close])

  // Focus trap — move focus into panel on open
  useEffect(() => {
    if (panelOpen && panelRef.current) {
      panelRef.current.focus()
    }
  }, [panelOpen])

  if (!panelOpen) {
    if (journeyCompleteOpen) {
      return <JourneyCompletePopup onDismiss={() => { setJourneyCompleteOpen(false); handleJourneyComplete() }} />
    }
    return null
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
        onClick={close}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Guide"
        tabIndex={-1}
        className="fixed z-50 flex flex-col outline-none"
        style={{
          // Desktop: right-side drawer
          top: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: 320,
          backgroundColor: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border-default)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
          animation: 'guide-panel-in 0.2s ease-out both',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          {/* Mini orb — click to close */}
          <button
            onClick={close}
            aria-label="Close Guide"
            className="flex items-center justify-center rounded-full shrink-0 hover:opacity-70 transition-opacity"
            style={{
              width: 28,
              height: 28,
              background: 'linear-gradient(135deg, var(--color-slate-500), var(--color-slate-700))',
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            🤖
          </button>

          <div className="flex-1 flex flex-col">
            <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Guide</span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ready to help</span>
          </div>

          {/* Edit mode toggle */}
          <button
            onClick={() => setEditMode(m => !m)}
            aria-label={editMode ? 'Done editing slots' : 'Edit slots'}
            aria-pressed={editMode}
            className="text-sm px-2 py-1 rounded-md transition-colors"
            style={{
              color: editMode ? 'var(--color-blue-600)' : 'var(--text-muted)',
              background: editMode ? 'var(--color-blue-50)' : 'none',
            }}
          >
            {editMode ? 'Done' : <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>⚙</span>}
          </button>

          {/* Close */}
          <button
            onClick={close}
            aria-label="Close Guide"
            className="text-xl leading-none hover:opacity-60 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>

        {/* Notifications — always visible above who's online */}
        <div className="shrink-0 px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border-default)' }}>
          <NotificationStack />
        </div>

        {/* Online strip — fixed between notifications and scroll body */}
        <OnlineStrip onlineUsers={[]} />

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5 p-4">
            <JourneyCard />
            <SlotGrid
              editMode={editMode}
              onAddSlot={() => setPickerOpen(true)}
              isAdmin={isAdmin}
              onSlotAction={key => { if (key === 'journey_complete') setJourneyCompleteOpen(true) }}
            />
          </div>
        </div>

        {/* Chat input footer (placeholder — Phase 4+) */}
        <div
          className="shrink-0 px-4 py-3"
          style={{ borderTop: '1px solid var(--border-default)' }}
        >
          <div
            className="flex items-center gap-2 rounded-full px-3 py-2"
            style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-default)' }}
          >
            <span style={{ fontSize: 16 }}>🤖</span>
            <span className="flex-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              Ask Guide anything…
            </span>
          </div>
        </div>
      </div>

      {/* Slot picker overlay */}
      {pickerOpen && (
        <SlotPicker onClose={() => setPickerOpen(false)} isAdmin={isAdmin} />
      )}

      {/* Journey complete popup — rendered here when panel stays open alongside it */}
      {journeyCompleteOpen && (
        <JourneyCompletePopup onDismiss={() => { setJourneyCompleteOpen(false); handleJourneyComplete() }} />
      )}
    </>
  )
}
