// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React from 'react'
import { Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'

export default function AdminRoute({ children }) {
  const { data: session, isPending } = useOptimisticSession()

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (session?.user?.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return children
}
