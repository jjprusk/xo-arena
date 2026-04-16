// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * ShareTableButton — copies the table's direct URL to the clipboard.
 *
 * Private tables are reachable by direct URL (share-link mechanism), so this
 * is especially useful for private tables the creator wants to hand to a
 * specific friend. Works the same for public tables too.
 *
 * Keeps the icon / label swap on success for ~1.2s so the user sees
 * feedback, then resets. Falls back gracefully on browsers that don't
 * expose navigator.clipboard (insecure contexts, old mobiles).
 */

import React, { useState } from 'react'

const COPIED_DISPLAY_MS = 1200

export default function ShareTableButton({ tableId, variant = 'icon', className = '' }) {
  const [state, setState] = useState('idle') // 'idle' | 'copied' | 'failed'

  async function handleShare(e) {
    e.preventDefault()
    e.stopPropagation()    // list rows have their own onClick — don't navigate
    const url = `${window.location.origin}/tables/${tableId}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        // Insecure-context fallback: temporary textarea + execCommand('copy')
        const ta = document.createElement('textarea')
        ta.value = url
        ta.style.position = 'fixed'
        ta.style.opacity  = '0'
        document.body.appendChild(ta)
        ta.select()
        // eslint-disable-next-line deprecation/deprecation
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('execCommand copy failed')
      }
      setState('copied')
      setTimeout(() => setState('idle'), COPIED_DISPLAY_MS)
    } catch {
      setState('failed')
      setTimeout(() => setState('idle'), COPIED_DISPLAY_MS)
    }
  }

  const title = state === 'copied' ? 'Link copied to clipboard'
              : state === 'failed' ? 'Copy failed — try again'
              : 'Copy share link to clipboard'
  const ariaLabel = `Share table link${state === 'copied' ? ' (copied)' : ''}`

  if (variant === 'icon') {
    // Compact icon-only button for list rows.
    return (
      <button
        type="button"
        onClick={handleShare}
        title={title}
        aria-label={ariaLabel}
        className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border transition-colors hover:bg-[var(--bg-surface-hover)] ${className}`}
        style={{
          borderColor: 'var(--border-default)',
          color: state === 'copied' ? 'var(--color-teal-600)'
               : state === 'failed' ? 'var(--color-red-600)'
               :                       'var(--text-muted)',
        }}
      >
        {state === 'copied' ? '✓' : state === 'failed' ? '!' : (
          <ShareIcon />
        )}
      </button>
    )
  }

  // Full button with label — used on the detail page action row.
  return (
    <button
      type="button"
      onClick={handleShare}
      title={title}
      className={`btn btn-ghost btn-sm inline-flex items-center gap-2 ${className}`}
    >
      <ShareIcon />
      {state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : 'Share'}
    </button>
  )
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {/* Classic share glyph — two nodes with a connecting line */}
      <circle cx="12" cy="4"  r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4"  cy="8"  r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.7 7 10.3 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5.7 9 10.3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
