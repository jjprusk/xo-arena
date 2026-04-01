import React, { useState } from 'react'
import { useGameStore } from '../../store/gameStore.js'
import { useRolesStore } from '../../store/rolesStore.js'
import FeedbackModal from './FeedbackModal.jsx'

export default function FeedbackButton({
  appId = 'xo-arena',
  apiBase = '/api/v1',
  hideWhenPlaying = true,
}) {
  const [open, setOpen] = useState(false)
  const hasRole = useRolesStore(s => s.hasRole)
  const gameStatus = useGameStore(s => s.status)
  const gameMode = useGameStore(s => s.mode)

  // Don't show for support users
  if (hasRole('SUPPORT')) return null

  // Hide when a game is actively in progress
  if (hideWhenPlaying && gameMode !== null && gameStatus === 'playing') return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        className="fixed bottom-6 right-5 z-40 w-11 h-11 rounded-full shadow-lg flex items-center justify-center text-lg transition-transform hover:scale-110 active:scale-95"
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
        onClose={() => setOpen(false)}
      />
    </>
  )
}
