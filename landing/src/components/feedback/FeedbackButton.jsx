// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import html2canvas from 'html2canvas'
import FeedbackModal from './FeedbackModal.jsx'
import { isMobile, compressImage } from '../../lib/screenshotUtils.js'

/**
 * Floating "💬 Send feedback" launcher. Ported from the retired frontend/
 * app (Phase 3.0) when the widget was re-added to landing.
 *
 * Hidden while a game is actively running (`/play` route) so the overlay
 * doesn't obscure the board; the old frontend used gameStore state for
 * this but landing has no such store — route prefix is a good-enough
 * heuristic.
 */
export default function FeedbackButton({
  appId = 'ai-arena',
  apiBase = '/api/v1',
  hideWhenPlaying = true,
}) {
  const [open, setOpen] = useState(false)
  const [screenshotData, setScreenshotData] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    function onMessage(e) {
      if (e.data?.type === 'open-feedback') setOpen(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (hideWhenPlaying && pathname.startsWith('/play')) return null

  async function handleClick() {
    if (isMobile()) {
      setScreenshotData(null)
      setOpen(true)
      return
    }
    setCapturing(true)
    try {
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        allowTaint: true,
      })
      const raw = canvas.toDataURL('image/jpeg', 1)
      const compressed = await compressImage(raw)
      setScreenshotData(compressed)
    } catch {
      setScreenshotData(null)
    } finally {
      setCapturing(false)
    }
    setOpen(true)
  }

  function handleClose() {
    setOpen(false)
    setScreenshotData(null)
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={capturing}
        aria-label="Send feedback"
        className="fixed bottom-20 md:bottom-6 right-5 z-40 w-11 h-11 rounded-full shadow-lg flex items-center justify-center text-lg transition-transform hover:scale-110 active:scale-95 disabled:opacity-60"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-md)',
          color: 'var(--text-primary)',
        }}
        title="Send feedback"
      >
        💬
      </button>
      <FeedbackModal
        appId={appId}
        apiBase={apiBase}
        open={open}
        onClose={handleClose}
        screenshotData={screenshotData}
      />
    </>
  )
}
