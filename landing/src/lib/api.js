// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Thin API client — wraps fetch with base URL and error handling.
 */

const BASE = import.meta.env.VITE_API_URL ?? ''

/**
 * Stale-while-revalidate fetch.
 * Returns { immediate, refresh } where:
 *   immediate — cached data from localStorage if within maxAgeMs (or null)
 *   refresh   — Promise that resolves with fresh data and updates the cache
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
    throw Object.assign(new Error(err.error || 'Request failed'), {
      status: res.status,
      code:   err.code ?? null,
    })
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
    getProfile:  (id)           => api.get(`/users/${id}`),
    stats:       (id)           => api.get(`/users/${id}/stats`),
    eloHistory:  (id)           => api.get(`/users/${id}/elo-history`),
    mlProfiles:  (id, token)    => api.get(`/users/${id}/ml-profiles`, token),
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
    restartJourney:   (token)       => api.post('/guide/journey/restart', {}, token),
    // Phase 0 (Intelligent Guide v1) — credit pre-signup Hook progress from
    // guest-mode localStorage immediately after a successful signup. Body:
    // `{ hookStep1CompletedAt?: ISO8601, hookStep2CompletedAt?: ISO8601 }`.
    guestCredit:      (payload, token) => api.post('/guide/guest-credit', payload, token),
    // NOTE: triggerStep() was removed in v1 — all 7 journey steps are now
    // server-detected at their natural trigger events (see Intelligent_Guide_
    // Requirements.md §4). Page-visit callers in FAQPage / GymGuidePage /
    // TournamentsPage have been removed to match.
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

  bots: {
    list: (params = {}) => {
      const p = new URLSearchParams()
      if (params.ownerId) p.set('ownerId', params.ownerId)
      if (params.includeInactive) p.set('includeInactive', 'true')
      const qs = p.toString()
      return request('GET', `/bots${qs ? `?${qs}` : ''}`, null, params.token)
    },
    mine:       (token)             => request('GET',    '/bots/mine', null, token),
    create:     (body, token)       => request('POST',   '/bots', body, token),
    quickCreate:(body, token)       => request('POST',   '/bots/quick', body, token),
    update:     (id, body, token)   => request('PATCH',  `/bots/${id}`, body, token),
    delete:     (id, token)         => request('DELETE', `/bots/${id}`, null, token),
    resetElo:   (id, token)         => request('POST',   `/bots/${id}/reset-elo`, {}, token),
    trainQuick: (id, token)         => request('POST',   `/bots/${id}/train-quick`, {}, token),
    trainGuided:        (id, token)             => request('POST',   `/bots/${id}/train-guided`, {}, token),
    trainGuidedFinalize:(id, body, token)       => request('POST',   `/bots/${id}/train-guided/finalize`, body, token),
  },

  botGames: {
    start:    (body, token) => request('POST', '/bot-games',          body, token),
    practice: (body, token) => request('POST', '/bot-games/practice', body, token),
  },

  skills: {
    list: (params = {}) => {
      const p = new URLSearchParams()
      if (params.gameId) p.set('gameId', params.gameId)
      const qs = p.toString()
      return request('GET', `/skills/models${qs ? `?${qs}` : ''}`, null, params.token)
    },
    create: (body, token) => request('POST', '/skills/models', body, token),
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
    stopTable:    (id, token)       => request('DELETE', `/admin/tables/${id}`, null, token),

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

    listBots: (token, search, page, limit, opts = {}) => {
      const p = new URLSearchParams()
      if (search)         p.set('search', search)
      if (page)           p.set('page', page)
      if (limit)          p.set('limit', limit)
      if (opts.systemOnly) p.set('systemOnly', '1')
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
    getReplayConfig: (token) => api.get('/admin/replay-config', token),
    setReplayConfig: (body, token) => api.patch('/admin/replay-config', body, token),

    // Phase 3.7a.6 — sweep-drop health signal (bot-only tournaments the
    // sweep hard-deleted for being unfilled). period ∈ { day | week | month }.
    tournamentsAutoDropped: (token, period = 'week') =>
      api.get(`/admin/tournaments/auto-dropped?period=${encodeURIComponent(period)}`, token),

    // Sprint 5 — Intelligent Guide v1 admin dashboard. Returns the freshly
    // computed snapshot in `now` plus the last 30 days of MetricsSnapshot
    // rows in `history` (for trend lines).
    guideMetrics: (token) => api.get('/admin/guide-metrics', token),

    // Sprint 6 — Intelligent Guide v1 SystemConfig editor. GET returns the
    // full 13-key map; PATCH accepts a partial map and returns the updated
    // 13-key map.
    getGuideConfig: (token)       => api.get('/admin/guide-config', token),
    setGuideConfig: (body, token) => api.patch('/admin/guide-config', body, token),
  },
  games: {
    getReplay:    (id, token)      => api.get(`/games/${id}/replay`, token),
    getByMatchId: (matchId, token) => api.get(`/games?tournamentMatchId=${encodeURIComponent(matchId)}`, token),
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

  // ── Tables (Phase 3.2) ──────────────────────────────────────────────
  tables: {
    /**
     * List tables.
     * @param {object}  [opts]
     * @param {boolean} [opts.mine]     — only tables the caller created (requires token)
     * @param {string}  [opts.status]   — single status or comma-separated list of
     *                                    'FORMING' | 'ACTIVE' | 'COMPLETED'
     * @param {string}  [opts.gameId]   — filter by game
     * @param {string}  [opts.search]   — seated-player displayName (case-insensitive partial)
     * @param {string}  [opts.since]    — ISO date; only tables created on/after
     * @param {number}  [opts.limit]    — default 20, max 200
     * @param {number}  [opts.page]     — 1-based page number (default 1)
     * @param {string}  [token]         — required when opts.mine is true
     * @returns {Promise<{ tables, total, page, limit }>}
     */
    list: ({ mine, status, gameId, search, since, limit, page } = {}, token) => {
      const p = new URLSearchParams()
      if (mine)   p.set('mine',   'true')
      if (status) p.set('status', status)
      if (gameId) p.set('gameId', gameId)
      if (search) p.set('search', search)
      if (since)  p.set('since',  since)
      if (limit)  p.set('limit',  String(limit))
      if (page)   p.set('page',   String(page))
      const qs = p.toString()
      return api.get(`/tables${qs ? `?${qs}` : ''}`, token)
    },
    /** Fetch a single table by id. Private tables are reachable by direct URL. */
    get:    (id, token) => api.get(`/tables/${id}`, token),
    /** Get the slug of the active (in-progress) table for a tournament match. */
    getActiveByMatchId: (matchId) => api.get(`/tables/active-match?tournamentMatchId=${encodeURIComponent(matchId)}`),
    /** Create a new table. body: { gameId, minPlayers, maxPlayers, isPrivate?, isTournament? } */
    create: (body, token) => api.post('/tables', body, token),
    /**
     * Create a private bot-vs-bot demo table — Hook step 2 (§5.1).
     * Server picks the matchup, seats both bots, and starts the game.
     * Returns `{ tableId, slug, displayName, botA, botB }`.
     */
    createDemo: (token) => api.post('/tables/demo', null, token),
    /** Claim an empty seat. Idempotent. Pass { seatIndex } to target a specific seat. */
    join:   (id, opts, token) => {
      // Back-compat: older callers pass (id, token) with no opts.
      const body = opts && typeof opts === 'object' && 'seatIndex' in opts ? { seatIndex: opts.seatIndex } : null
      const resolvedToken = (typeof opts === 'string') ? opts : token
      return api.post(`/tables/${id}/join`, body, resolvedToken)
    },
    /** Vacate the caller's seat. Idempotent. */
    leave:  (id, token) => api.post(`/tables/${id}/leave`, null, token),
    /** Delete a table (creator-only, and only when not ACTIVE). */
    delete: (id, token) => api.delete(`/tables/${id}`, token),
  },
}
