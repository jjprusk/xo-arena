// Copyright © 2026 Joe Pruskowski. All rights reserved.
import React, { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'
import { api } from '../../lib/api.js'
import { getToken } from '../../lib/getToken.js'

/**
 * Gates a route for ADMIN or HELP_ADMIN users. Differs from AdminRoute in
 * that it also fetches the domain roles list (since HELP_ADMIN is a
 * UserRole row, not a BetterAuth role) and admits the user if either
 * source carries the right role.
 */
export default function HelpAdminRoute({ children }) {
  const { data: session, isPending } = useOptimisticSession()
  const [rolesPending, setRolesPending] = useState(true)
  const [domainRoles, setDomainRoles] = useState([])

  useEffect(() => {
    let cancelled = false
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
        // Treat fetch failure as "no roles" — AdminRoute path will reject.
      } finally {
        if (!cancelled) setRolesPending(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [session?.user?.id])

  if (isPending || rolesPending) {
    return (
      <div className="flex items-center justify-center py-16" data-testid="helpadminroute-loading">
        <div className="w-8 h-8 border-4 border-[var(--color-blue-600)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isBaAdmin   = session?.user?.role === 'admin'
  const hasAdmin    = domainRoles.includes('ADMIN')
  const hasHelp     = domainRoles.includes('HELP_ADMIN')

  if (!isBaAdmin && !hasAdmin && !hasHelp) {
    return <Navigate to="/" replace />
  }
  return children
}
