import React from 'react'
import { useOptimisticSession } from '../lib/useOptimisticSession.js'

// TODO: port tournament classification profile from xo.aiarena ProfilePage
export default function ProfilePage() {
  const { data: session, isPending } = useOptimisticSession()
  const user = session?.user ?? null

  if (isPending) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="h-6 w-32 rounded animate-pulse" style={{ backgroundColor: 'var(--border-default)' }} />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to view your profile.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-12 space-y-6">
      <div className="pb-4 border-b" style={{ borderColor: 'var(--border-default)' }}>
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
          {user.name ?? user.email}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Tournament classification and history coming soon.
        </p>
      </div>
    </div>
  )
}
