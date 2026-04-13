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
  delete: (path, token) => request('DELETE', path, null, token),

  users: {
    sync:        (token)        => api.post('/users/sync', {}, token),
    stats:       (id)           => api.get(`/users/${id}/stats`),
    eloHistory:  (id)           => api.get(`/users/${id}/elo-history`),
    credits:     (id)           => api.get(`/users/${id}/credits`),
    updateSettings: (body, token) => api.patch('/users/me/settings', body, token),
    getPreferences:   (token)       => api.get('/users/me/preferences', token),
    patchPreferences: (body, token) => api.patch('/users/me/preferences', body, token),
    getNotifPrefs:    (token)       => api.get('/users/notification-preferences', token),
    putNotifPref:     (eventType, body, token) => request('PUT', `/users/notification-preferences/${eventType}`, body, token),
  },

  guide: {
    getPreferences:   (token)       => api.get('/guide/preferences', token),
    patchPreferences: (body, token) => api.patch('/guide/preferences', body, token),
    triggerStep:      (step, token) => api.post('/guide/journey/step', { step }, token),
    restartJourney:   (token)       => api.post('/guide/journey/restart', {}, token),
  },

  bots: {
    list: (params = {}) => {
      const p = new URLSearchParams()
      if (params.ownerId) p.set('ownerId', params.ownerId)
      if (params.includeInactive) p.set('includeInactive', 'true')
      const qs = p.toString()
      return request('GET', `/bots${qs ? `?${qs}` : ''}`, null, params.token)
    },
    mine:     (token)              => request('GET',    '/bots/mine', null, token),
    create:   (body, token)        => request('POST',   '/bots', body, token),
    update:   (id, body, token)    => request('PATCH',  `/bots/${id}`, body, token),
    delete:   (id, token)          => request('DELETE', `/bots/${id}`, null, token),
    resetElo: (id, token)          => request('POST',   `/bots/${id}/reset-elo`, {}, token),
  },

  botGames: {
    start: (body, token) => request('POST', '/bot-games', body, token),
  },

  logs: {
    list: (token, params = {}) => {
      const p = new URLSearchParams()
      if (params.limit)     p.set('limit',     params.limit)
      if (params.page)      p.set('page',      params.page)
      if (params.level)     p.set('level',     params.level)
      if (params.source)    p.set('source',    params.source)
      if (params.userId)    p.set('userId',    params.userId)
      if (params.sessionId) p.set('sessionId', params.sessionId)
      if (params.roomId)    p.set('roomId',    params.roomId)
      if (params.search)    p.set('search',    params.search)
      const qs = p.toString()
      return api.get(`/logs${qs ? `?${qs}` : ''}`, token)
    },
  },

  admin: {
    stats:        (token)           => api.get('/admin/stats', token),
    getHealth:    (token)           => api.get('/admin/health/sockets', token),
    getUser:      (id, token)       => api.get(`/admin/users/${id}`, token),
    users:        (token, search, page, limit, status) => {
      const p = new URLSearchParams()
      if (search) p.set('search', search)
      if (page)   p.set('page', page)
      if (limit)  p.set('limit', limit)
      if (status) p.set('status', status)
      const qs = p.toString()
      return api.get(`/admin/users${qs ? `?${qs}` : ''}`, token)
    },
    updateUser:   (id, body, token) => api.patch(`/admin/users/${id}`, body, token),
    deleteUser:   (id, token)       => request('DELETE', `/admin/users/${id}`, null, token),
    games:        (token, page, limit, filters) => {
      const p = new URLSearchParams()
      if (page)            p.set('page', page)
      if (limit)           p.set('limit', limit)
      if (filters?.mode)     p.set('mode', filters.mode)
      if (filters?.outcome)  p.set('outcome', filters.outcome)
      if (filters?.player)   p.set('player', filters.player)
      if (filters?.dateFrom) p.set('dateFrom', filters.dateFrom)
      if (filters?.dateTo)   p.set('dateTo', filters.dateTo)
      const qs = p.toString()
      return api.get(`/admin/games${qs ? `?${qs}` : ''}`, token)
    },
    deleteGame:   (id, token)       => request('DELETE', `/admin/games/${id}`, null, token),

    listModels:   (token, search, status, page, limit) => {
      const p = new URLSearchParams()
      if (search) p.set('search', search)
      if (status) p.set('status', status)
      if (page)   p.set('page', page)
      if (limit)  p.set('limit', limit)
      const qs = p.toString()
      return api.get(`/admin/ml/models${qs ? `?${qs}` : ''}`, token)
    },
    featureModel:        (id, token)         => api.patch(`/admin/ml/models/${id}/feature`, {}, token),
    setModelMaxEpisodes: (id, max, token)    => api.patch(`/admin/ml/models/${id}/max-episodes`, { maxEpisodes: max }, token),
    deleteModel:         (id, token)         => request('DELETE', `/admin/ml/models/${id}`, null, token),
    getMLLimits:   (token)       => api.get('/admin/ml/limits', token),
    setMLLimits:   (body, token) => api.patch('/admin/ml/limits', body, token),
    getLogLimit:   (token)       => api.get('/admin/logs/limit', token),
    setLogLimit:   (body, token) => api.patch('/admin/logs/limit', body, token),

    listBots: (token, search, page, limit) => {
      const p = new URLSearchParams()
      if (search) p.set('search', search)
      if (page)   p.set('page', page)
      if (limit)  p.set('limit', limit)
      const qs = p.toString()
      return api.get(`/admin/bots${qs ? `?${qs}` : ''}`, token)
    },
    updateBot: (id, body, token) => api.patch(`/admin/bots/${id}`, body, token),
    deleteBot: (id, token) => request('DELETE', `/admin/bots/${id}`, null, token),
    getBotLimits: (token) => api.get('/admin/bot-limits', token),
    setBotLimits: (body, token) => api.patch('/admin/bot-limits', body, token),
    getAivaiConfig: (token) => api.get('/admin/aivai-config', token),
    setAivaiConfig: (body, token) => api.patch('/admin/aivai-config', body, token),
    getIdleConfig: (token) => api.get('/admin/idle-config', token),
    setIdleConfig: (body, token) => api.patch('/admin/idle-config', body, token),
    getSessionConfig: (token) => api.get('/admin/session-config', token),
    setSessionConfig: (body, token) => api.patch('/admin/session-config', body, token),
  },
}
