/**
 * Thin API client — wraps fetch with base URL and error handling.
 */

const BASE = import.meta.env.VITE_API_URL ?? ''

async function request(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status })
  }

  if (res.status === 204) return null
  return res.json()
}

export const api = {
  get: (path, token) => request('GET', path, null, token),
  post: (path, body, token) => request('POST', path, body, token),
  patch: (path, body, token) => request('PATCH', path, body, token),

  ai: {
    implementations: () => api.get('/ai/implementations'),
    move: (board, difficulty, player, implementation) =>
      api.post('/ai/move', { board, difficulty, player, implementation }),
  },

  rooms: {
    list: () => api.get('/rooms'),
  },

  logs: {
    ingest: (entries) => api.post('/logs', { entries }),
  },
}
