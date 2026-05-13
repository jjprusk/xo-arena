// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

/**
 * Wraps the `/admin` exact landing route.
 *
 *   ADMIN (BetterAuth or domain) → render children (AdminDashboard)
 *   HELP_ADMIN only              → redirect to /admin/help
 *   No relevant role             → redirect to /
 *
 * Why this exists alongside AdminRoute: AdminRoute is the gate for the
 * 13 admin sub-pages and bounces non-admins. HELP_ADMIN-only users would
 * be bounced to / which is the wrong "this is not for you" UX. This
 * route sends them straight to the surface they CAN edit.
 */
export default function AdminLandingRoute({ children }) {
  const { data: session, isPending } = useOptimisticSession()
  const [rolesPending, setRolesPending] = useState(true)
  const [domainRoles, setDomainRoles] = useState([])

  const isBaAdmin = session?.user?.role === 'admin'

  useEffect(() => {
    let cancelled = false
    // BA admin short-circuits — no need to round-trip for domain roles.
    if (isBaAdmin) {
      setRolesPending(false)
      return
    }
    async function load() {
      if (!session?.user) {
        setRolesPending(false)
        return
      }
      try {
        const token = await getToken()
        const { roles } = await api.me.getRoles(token)
        if (!cancelled) setDomainRoles(Array.isArray(roles) ? roles : [])
      } catch {
        // fall through to "no roles"
      } finally {
        if (!cancelled) setRolesPending(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [session?.user?.id, isBaAdmin])

  if (isPending || rolesPending) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="adminlanding-loading">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (isBaAdmin || domainRoles.includes('ADMIN')) return children
  if (domainRoles.includes('HELP_ADMIN')) return <Navigate to="/admin/help" replace />
  return <Navigate to="/" replace />
}
