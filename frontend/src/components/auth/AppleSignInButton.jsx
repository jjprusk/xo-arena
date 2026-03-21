import React from 'react'
import { signIn } from '../../lib/auth-client.js'

export default function AppleSignInButton({ callbackURL = '/play' }) {
  async function handleClick() {
    await signIn.social({ provider: 'apple', callbackURL })
  }

  return (
    <button
      onClick={handleClick}
      className="w-full h-10 rounded-lg border flex items-center justify-center gap-3 text-sm font-medium transition-colors hover:bg-[var(--bg-surface-hover)]"
      style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-surface)' }}
    >
      {/* Apple logo */}
      <svg width="16" height="18" viewBox="0 0 814 1000" fill="currentColor">
        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 405.6 0 279.3 0 160.2 0 74 29.1 24.4 78.5 24.4c26.1 0 81.5 12.5 81.5 127.4 0 83.1 26.3 133.8 79.3 133.8 26.4 0 47.4-8.1 47.4-33.5 0-88.5-85.1-87.5-85.1-175.2 0-91.7 69.4-151.6 163.1-151.6 83.5 0 137.8 55.6 137.8 155.5 0 102.9-71.3 213.4-71.3 247.8 0 31.7 23.2 45.6 59.2 45.6 109.5 0 135.5-133.6 135.5-168.6 0-26.2-5.8-31.2-17.4-31.2-14.7 0-29.5 12.3-43.6 12.3-18.5 0-29.8-14.2-29.8-30.8 0-22.6 19.7-43.8 19.7-43.8z"/>
      </svg>
      Continue with Apple
    </button>
  )
}
