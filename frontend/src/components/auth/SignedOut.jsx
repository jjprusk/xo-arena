import React from 'react'
import { useOptimisticSession } from '../../lib/useOptimisticSession.js'

export default function SignedOut({ children }) {
  const { data: session, isPending } = useOptimisticSession()
  if (isPending || session) return null
  return children
}
