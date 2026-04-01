import React from 'react'
import { Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { useRolesStore } from '../../store/rolesStore.js'

export default function SupportRoute({ children }) {
  const { data: session, isPending } = useOptimisticSession()
  const hasRole = useRolesStore(s => s.hasRole)

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isAdmin = session?.user?.role === 'admin'
  const isSupport = hasRole('SUPPORT')

  if (!isAdmin && !isSupport) {
    return <Navigate to="/play" replace />
  }

  return children
}
