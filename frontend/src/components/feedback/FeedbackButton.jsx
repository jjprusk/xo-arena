import React, { useState } from 'react'
import html2canvas from 'html2canvas'
import { useGameStore } from '../../store/gameStore.js'
import { useRolesStore } from '../../store/rolesStore.js'
import FeedbackModal from './FeedbackModal.jsx'
import { isMobile, compressImage } from '../../lib/screenshotUtils.js'

export default function FeedbackButton({
  appId = 'xo-arena',
  apiBase = '/api/v1',
  hideWhenPlaying = true,
}) {
  const [open, setOpen] = useState(false)
  const [screenshotData, setScreenshotData] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const hasRole = useRolesStore(s => s.hasRole)
  const gameStatus = useGameStore(s => s.status)
  const gameMode = useGameStore(s => s.mode)

  // Don't show for support users
  if (hasRole('SUPPORT')) return null

  // Hide when a game is actively in progress
  if (hideWhenPlaying && gameMode !== null && gameStatus === 'playing') return null

  async function handleClick() {
    if (isMobile()) {
      // Mobile: skip auto-capture; the modal offers a file picker instead
      setScreenshotData(null)
      setOpen(true)
      return
    }
    // Desktop: capture the page before the modal mounts so the modal isn't in the shot
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
      // Non-fatal: open the modal without a screenshot
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
        className="fixed bottom-6 right-5 z-40 w-11 h-11 rounded-full shadow-lg flex items-center justify-center text-lg transition-transform hover:scale-110 active:scale-95 disabled:opacity-60"
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
