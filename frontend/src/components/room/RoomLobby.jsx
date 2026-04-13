// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { usePvpStore } from '../../store/pvpStore.js'

/**
 * RoomLobby — shown after host creates a room, while waiting for a guest.
 * Displays invite link, spectator count, and allows name swap.
 */
export default function RoomLobby() {
  const { slug, displayName, spectatorCount, swapName, cancelRoom } = usePvpStore()
  const [copied, setCopied] = useState(false)

  const inviteUrl = slug ? `${window.location.origin}/play?join=${slug}` : ''

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-sm mx-auto w-full text-center">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Your room</p>
        <div className="flex items-center justify-center gap-2">
          <h2 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            {displayName || '…'}
          </h2>
          <button
            onClick={swapName}
            aria-label="Get different room name"
            className="text-lg transition-colors hover:text-[var(--color-blue-600)]"
            style={{ color: 'var(--text-muted)' }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* Invite link */}
      <div className="rounded-xl border p-4 space-y-3" style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-default)', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Share this link to invite your opponent:
        </p>
        <div className="flex gap-2">
          <input
            readOnly
            value={inviteUrl}
            className="flex-1 px-3 py-2 rounded-lg border text-xs font-mono truncate"
            style={{
              backgroundColor: 'var(--bg-page)',
              borderColor: 'var(--border-default)',
              color: 'var(--text-secondary)',
            }}
          />
          <button
            onClick={handleCopy}
            className={`btn ${copied ? 'btn-teal' : 'btn-primary'}`}
          >
            {copied ? '✓' : 'Copy'}
          </button>
        </div>

        {/* Native share (mobile) */}
        {navigator.share && (
          <button
            onClick={() => navigator.share({ title: `Join me in ${displayName}`, url: inviteUrl })}
            className="w-full py-2 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--bg-surface-hover)]"
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            Share invite link
          </button>
        )}
      </div>

      {/* Waiting spinner */}
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-6 h-6 border-2 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Waiting for opponent…
        </p>
        {spectatorCount > 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            👁 {spectatorCount} spectator{spectatorCount !== 1 ? 's' : ''} watching
          </p>
        )}
      </div>

      <button
        onClick={cancelRoom}
        className="text-sm transition-colors hover:text-[var(--color-red-600)]"
        style={{ color: 'var(--text-muted)' }}
      >
        Cancel room
      </button>
    </div>
  )
}
