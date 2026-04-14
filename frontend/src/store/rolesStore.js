// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { create } from 'zustand'
import { getToken } from '../lib/getToken.js'

const BASE = import.meta.env.VITE_API_URL ?? ''

export const useRolesStore = create((set, get) => ({
  roles: [],

  async fetch() {
    try {
      const token = await getToken()
      if (!token) { set({ roles: [] }); return }
      const res = await fetch(`${BASE}/api/v1/users/me/roles`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) { set({ roles: [] }); return }
      const data = await res.json()
      set({ roles: data.roles ?? [] })
    } catch {
      set({ roles: [] })
    }
  },

  clear() {
    set({ roles: [] })
  },

  hasRole(role) {
    return get().roles.includes(role)
  },

  isAdminOrSupport(session) {
    return session?.user?.role === 'admin' || get().hasRole('SUPPORT')
  },
}))
