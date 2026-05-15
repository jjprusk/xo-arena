// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useGuideStore } from '../../store/guideStore.js'
import { POST_JOURNEY_SLOTS } from './slotActions.js'
import NotificationStack from './NotificationStack.jsx'
import JourneyCard from './JourneyCard.jsx'
import SlotGrid from './SlotGrid.jsx'
import SlotPicker from './SlotPicker.jsx'
import OnlineStrip from './OnlineStrip.jsx'
import HelpInput from './HelpInput.jsx'
import HelpThread from './HelpThread.jsx'
import JourneyCompletePopup from '../ui/JourneyCompletePopup.jsx'

/**
 * GuidePanel — slide-in panel from the right.
 * 320px on desktop, full-width bottom-sheet on mobile.
 * Closes on Escape or clicking the backdrop.
 */
// Note: handleJourneyComplete is called inside GuidePanel so it has access to navigate.
// Defined as a closure below inside the component.

export default function GuidePanel({ isAdmin = false }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { panelOpen, close, onlineUsers } = useGuideStore()
  const [editMode,            setEditMode]            = useState(false)
  const [pickerOpen,          setPickerOpen]          = useState(false)
  const [journeyCompleteOpen, setJourneyCompleteOpen] = useState(false)
  const panelRef = useRef(null)

  function handleJourneyComplete() {
    useGuideStore.getState().completeJourney(POST_JOURNEY_SLOTS)
    navigate('/tournaments')
  }

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

  // Body scroll-lock — when the drawer is open, the main page is greyed
  // out by the backdrop, but its scrollbar stays interactive otherwise.
  // Two scrolls (drawer + main page) is confusing; lock body scroll
  // while the drawer is up. Class-based so reduced-motion / a11y CSS
  // can override if needed.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (panelOpen) {
      document.body.classList.add('guide-open')
      return () => document.body.classList.remove('guide-open')
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
        <OnlineStrip onlineUsers={onlineUsers} />

        {/* Pinned primary surface — journey + slot buttons never scroll
            off the panel. These are the user's main nav inside the
            drawer, so they're always at hand. */}
        <div className="shrink-0 flex flex-col gap-5 px-4 pt-4">
          <JourneyCard />
          <SlotGrid
            editMode={editMode}
            onAddSlot={() => setPickerOpen(true)}
            isAdmin={isAdmin}
            onSlotAction={key => { if (key === 'journey_complete') setJourneyCompleteOpen(true) }}
          />
        </div>

        {/* Help thread — the only region inside the panel body that
            scrolls. Latest answer stays adjacent to the input below
            it (chat-app convention). Empty thread → just a blank
            spacer waiting for the first question. */}
        <div className="flex-1 overflow-y-auto px-4 pt-5 pb-4">
          <HelpThread />
        </div>

        {/* Help input — wired to /api/v1/help/ask (Sprint 3 §3.1) */}
        <HelpInput context={{ route: location?.pathname }} />
      </div>

      {/* Slot picker overlay */}
      {pickerOpen && (
        <SlotPicker onClose={() => setPickerOpen(false)} isAdmin={isAdmin} />
      )}

      {/* Journey complete popup */}
      {journeyCompleteOpen && (
        <JourneyCompletePopup onDismiss={() => { setJourneyCompleteOpen(false); handleJourneyComplete() }} />
      )}
    </>
  )
}
