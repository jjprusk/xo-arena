import React from 'react'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'

// TODO: port tournament notification preferences from xo.aiarena SettingsPage
export default function SettingsPage() {
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null

  if (isPending) return null

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to manage settings.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          Settings
        </h1>
      </div>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Tournament notification preferences coming soon.
      </p>
    </div>
  )
}
