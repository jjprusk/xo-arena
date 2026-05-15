// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * HelpThread — Sprint 3 §3.2 of doc/Help_System_Sprint_Tracker.md.
 *
 * Stacks the current help thread above JourneyCard/SlotGrid inside
 * GuidePanel. Empty thread → renders nothing (Sprint 3 §3.2 spec is
 * additive; the panel still works pre-first-question with just the
 * existing journey/slots surface).
 *
 * Most-recent turn is rendered last so the eye lands on the latest
 * question. We don't auto-scroll-to-bottom here — the GuidePanel's
 * scroll container handles vertical overflow, and forcing a scroll on
 * every token would fight the user's manual scroll-back behaviour.
 */

import React, { useEffect, useRef } from 'react'
import { useHelpStore } from '../../store/helpStore.js'
import HelpAnswer from './HelpAnswer.jsx'

export default function HelpThread() {
  const thread = useHelpStore(s => s.thread)
  const latestRef = useRef(null)

  // Auto-scroll only when a new turn is appended (thread length grew).
  // We anchor the NEW turn's TOP at the top of the scroll container
  // (`block: 'start'`) — the rest of the answer extends below into the
  // scrollable area where the user can manually scroll down to follow.
  // We do NOT scroll on streaming tokens or on done/error transitions —
  // that would yank the user if they've scrolled back to re-read an
  // earlier answer. One scroll per new question is the right amount of
  // "follow along without taking over."
  useEffect(() => {
    if (!latestRef.current || thread.length === 0) return
    try {
      latestRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch {}
  }, [thread.length])

  if (!thread || thread.length === 0) return null

  const lastIndex = thread.length - 1
  return (
    <div className="flex flex-col gap-3" data-testid="help-thread">
      {thread.map((turn, i) => (
        <HelpAnswer
          key={turn.id}
          turn={turn}
          innerRef={i === lastIndex ? latestRef : null}
        />
      ))}
    </div>
  )
}
