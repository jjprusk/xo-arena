import React from 'react'
import { useSession } from '../../lib/auth-client.js'

export default function SignedOut({ children }) {
  const { data: session, isPending } = useSession()
  if (isPending || session) return null
  return children
}
