/**
 * Thin API client — wraps fetch with base URL and error handling.
 */

const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * Stale-while-revalidate fetch.
 * Returns { immediate, refresh } where:
 *   immediate — cached data from localStorage if within maxAgeMs (or null)
 *   refresh   — Promise that resolves with fresh data and updates the cache
 *
 * Usage: show `immediate` right away (no spinner), update when `refresh` resolves.
 */
export function cachedFetch(path, maxAgeMs = 5 * 60_000) {
  const key = 'xo_swr_' + path
  let immediate = null
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const entry = JSON.parse(raw)
      if (Date.now() - entry.ts < maxAgeMs) immediate = entry.data
    }
  } catch {}

  const refresh = fetch(`${BASE}/api/v1${path}`)
    .then(r => {
      if (!r.ok) return Promise.reject(new Error(r.statusText))
      return r.json()
    })
    .then(data => {
      try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch {}
      return data
    })

  return { immediate, refresh }
}

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
    move: (board, difficulty, player, implementation, modelId, explain = false, userId = null, humanLastMove = null) =>
      request('POST', `/ai/move${explain ? '?explain=true' : ''}`, {
        board, difficulty, player, implementation, modelId,
        ...(userId ? { userId } : {}),
        ...(humanLastMove !== null && humanLastMove !== undefined ? { humanLastMove } : {}),
      }),
  },

  ml: {
    listModels:       ()           => api.get('/ml/models'),
    getNetworkConfig: ()           => api.get('/ml/network-config'),
    createModel:      (body, tok)  => api.post('/ml/models', body, tok),
    getModel:         (id)         => api.get(`/ml/models/${id}`),
    updateModel:      (id, b, tok) => api.patch(`/ml/models/${id}`, b, tok),
    deleteModel:      (id, tok)    => request('DELETE', `/ml/models/${id}`, null, tok),
    resetModel:       (id, tok)    => api.post(`/ml/models/${id}/reset`, {}, tok),
    cloneModel:       (id, b, tok) => api.post(`/ml/models/${id}/clone`, b, tok),
    getQTable:        (id)         => api.get(`/ml/models/${id}/qtable`),
    explainMove:      (id, board)  => api.post(`/ml/models/${id}/explain`, { board }),
    train:            (id, b, tok) => api.post(`/ml/models/${id}/train`, b, tok),
    finishSession:    (id, b, tok) => api.post(`/ml/sessions/${id}/finish`, b, tok),
    getSessions:      (id)         => api.get(`/ml/models/${id}/sessions`),
    getSession:       (id)         => api.get(`/ml/sessions/${id}`),
    getEpisodes:      (id, page)   => api.get(`/ml/sessions/${id}/episodes?page=${page}&limit=500`),
    cancelSession:    (id, tok)    => api.post(`/ml/sessions/${id}/cancel`, {}, tok),
    getCheckpoints:   (id)         => api.get(`/ml/models/${id}/checkpoints`),
    getCheckpoint:    (id, cpId)   => api.get(`/ml/models/${id}/checkpoints/${cpId}`),
    saveCheckpoint:   (id, tok)    => api.post(`/ml/models/${id}/checkpoint`, {}, tok),
    restoreCheckpoint:(id,cp,tok)  => api.post(`/ml/models/${id}/checkpoints/${cp}/restore`, {}, tok),
    getOpeningBook:   (id)         => api.get(`/ml/models/${id}/opening-book`),
    exportModel:      (id)         => api.get(`/ml/models/${id}/export`),
    importModel:      (data, tok)  => api.post('/ml/models/import', data, tok),
    getEloHistory:    (id)              => api.get(`/ml/models/${id}/elo-history`),
    startBenchmark:   (id, tok)         => api.post(`/ml/models/${id}/benchmark`, {}, tok),
    listBenchmarks:   (id)              => api.get(`/ml/models/${id}/benchmarks`),
    getBenchmark:     (id)              => api.get(`/ml/benchmark/${id}`),
    runVersus:        (id, id2, g, tok) => api.post(`/ml/models/${id}/versus/${id2}`, { games: g }, tok),
    startTournament:  (data, tok)       => api.post('/ml/tournament', data, tok),
    listTournaments:  ()                => api.get('/ml/tournaments'),
    getTournament:    (id)              => api.get(`/ml/tournament/${id}`),
    startHyperparamSearch: (id, body, tok) => api.post(`/ml/models/${id}/hypersearch`, body, tok),
    explainActivations: (id, board) => api.post(`/ml/models/${id}/explain-activations`, { board }),
    ensembleMove: (body) => api.post('/ml/models/ensemble', body),
    getPlayerProfiles: (id) => api.get(`/ml/models/${id}/player-profiles`),
    getPlayerProfile: (id, userId) => api.get(`/ml/models/${id}/player-profiles/${userId}`),
    recordHumanMove: (modelId, userId, board, cellIndex) => api.post(`/ml/models/${modelId}/player-profiles/${userId}/human-move`, { board, cellIndex }),
    recordGameEnd: (modelId, userId) => api.post(`/ml/models/${modelId}/player-profiles/${userId}/game-end`, {}),

    listRuleSets:     ()              => api.get('/ml/rulesets'),
    createRuleSet:    (body, tok)     => api.post('/ml/rulesets', body, tok),
    getRuleSet:       (id)            => api.get(`/ml/rulesets/${id}`),
    updateRuleSet:    (id, body, tok) => api.patch(`/ml/rulesets/${id}`, body, tok),
    deleteRuleSet:    (id, tok)       => request('DELETE', `/ml/rulesets/${id}`, null, tok),
    extractRules:     (id, body, tok) => api.post(`/ml/rulesets/${id}/extract`, body, tok),
  },

  rooms: {
    list: () => api.get('/rooms'),
  },

  users: {
    sync: (token) => api.post('/users/sync', {}, token),
    stats: (id) => api.get(`/users/${id}/stats`),
    eloHistory: (id) => api.get(`/users/${id}/elo-history`),
    games: (id, page = 1) => api.get(`/users/${id}/games?page=${page}&limit=20`),
    mlProfiles: (id, token) => api.get(`/users/${id}/ml-profiles`, token),
  },

  games: {
    record: (body, token) => api.post('/games', body, token),
  },

  admin: {
    stats:        (token)           => api.get('/admin/stats', token),
    users:        (token, search, page, limit) => {
      const p = new URLSearchParams()
      if (search) p.set('search', search)
      if (page)   p.set('page', page)
      if (limit)  p.set('limit', limit)
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
  },

  botGames: {
    start: (body, token) => request('POST', '/bot-games', body, token),
    list: () => api.get('/bot-games'),
    get: (slug) => api.get(`/bot-games/${slug}`),
  },

  bots: {
    list: (params = {}) => {
      const p = new URLSearchParams()
      if (params.ownerId) p.set('ownerId', params.ownerId)
      if (params.includeInactive) p.set('includeInactive', 'true')
      const qs = p.toString()
      return request('GET', `/bots${qs ? `?${qs}` : ''}`, null, params.token)
    },
    create: (body, token) => request('POST', '/bots', body, token),
    update: (id, body, token) => request('PATCH', `/bots/${id}`, body, token),
    resetElo: (id, token) => request('POST', `/bots/${id}/reset-elo`, {}, token),
    delete: (id, token) => request('DELETE', `/bots/${id}`, null, token),
  },

  puzzles: {
    list: (type, count) => {
      const params = new URLSearchParams()
      if (type) params.set('type', type)
      if (count) params.set('count', count)
      const qs = params.toString()
      return api.get(`/puzzles${qs ? `?${qs}` : ''}`)
    },
  },

  logs: {
    ingest: (entries) => api.post('/logs', { entries }),
    list:   (token, params = {}) => {
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
}
