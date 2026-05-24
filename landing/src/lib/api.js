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

// Phase 1c — module-level in-flight cache for `users.sync`. Keyed by token
// so concurrent callers in the same render pass share one HTTP round-trip.
// See `users.sync` below for the rationale + the perf doc §F11.4.
const _syncInFlight = new Map() // token → Promise

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
    // Phase 1c — cold-authed orchestration cleanup. AppLayout fires two
    // parallel effects on cold-authed first paint that both need a
    // hydrated User row (`AppLayout.jsx:288` and `:439`). Without dedupe,
    // each fired its own /users/sync round-trip — measured ~60ms p50
    // wasted RTT (perf doc §F11.4, ~30% of cold-authed Ready). Cache the
    // in-flight promise per token so concurrent callers share one
    // request; clear on settle so retries refetch fresh.
    sync:        (token)        => {
      const key = token || ''
      const existing = _syncInFlight.get(key)
      if (existing) return existing
      const promise = api.post('/users/sync', {}, token)
        .finally(() => { _syncInFlight.delete(key) })
      _syncInFlight.set(key, promise)
      return promise
    },
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

  play: {
    /**
     * One-shot HvB start (Future_Ideas PlayVsBot CTA item 3).
     *
     * Bundles the community-bot resolution, SSE session pre-allocation and
     * HvB table create into a single POST. The response carries everything
     * needed to render the opening board immediately — no SSE bootstrap on
     * the perf-ready critical path. The shared EventSource opens in
     * parallel using `?sseSession=<id>` to claim the pre-allocated session.
     */
    // Token is optional — the endpoint accepts anonymous callers (guest
    // PvAI flow). When a signed-in user lands here, the token is required
    // so the server resolves the caller as the user (seatId =
    // user.betterAuthId) rather than a guest. Without it, the table seat
    // is `guest:<sseSession>` while subsequent move POSTs (which always
    // attach the Bearer via rtFetch) resolve to the user's betterAuthId
    // → seat mismatch → 403 NOT_A_PLAYER.
    startBot: ({ gameId = 'tic-tac-toe', botUserId } = {}, token) =>
      api.post('/play/bot', { gameId, ...(botUserId ? { botUserId } : {}) }, token),

    /**
     * Ranked best-of-2 vs a community bot (A2.4). Mints the Match row,
     * pre-allocates the SSE session, and spawns game 1's HvB table with
     * the first-mover-aware mark assignment. Auth required.
     *
     * Response shape (200):
     *   { sseSessionId, match: { id, format, sequence, p1IsFirstMover,
     *     humanIsFirstMover }, tableId, slug, label, mark, board,
     *     currentTurn, bot: {...} }
     */
    startRankedBot: ({ gameId = 'tic-tac-toe', botUserId } = {}, token) =>
      api.post('/play/ranked-bot', { gameId, ...(botUserId ? { botUserId } : {}) }, token),
  },

  research: {
    // Sprint 1 of doc/Research_Log_Plan.md — TrainingSessionNote CRUD.
    createNote: (sessionId, body, token) =>
      api.post(`/research/sessions/${sessionId}/notes`, body, token),
    updateNote: (noteId, body, token) => api.patch(`/research/notes/${noteId}`, body, token),
    deleteNote: (noteId, token)       => request('DELETE', `/research/notes/${noteId}`, null, token),
    listNotes:  (params = {}, token)  => {
      const p = new URLSearchParams()
      if (params.outcome) p.set('outcome', params.outcome)
      if (params.tag)     p.set('tag',     params.tag)
      if (params.since)   p.set('since',   params.since)
      if (params.limit)   p.set('limit',   String(params.limit))
      const qs = p.toString()
      return api.get(`/research/notes${qs ? `?${qs}` : ''}`, token)
    },
    getNote:    (noteId, token)       => api.get(`/research/notes/${noteId}`, token),

    // Sprint 2 — publish/unpublish + entries + community + export.
    publishNote:    (noteId, token) => api.post(`/research/notes/${noteId}/publish`, {}, token),
    unpublishNote:  (noteId, token) => api.post(`/research/notes/${noteId}/unpublish`, {}, token),

    createEntry:    (body, token)   => api.post('/research/entries', body, token),
    updateEntry:    (id, body, tok) => api.patch(`/research/entries/${id}`, body, tok),
    deleteEntry:    (id, tok)       => request('DELETE', `/research/entries/${id}`, null, tok),
    listEntries:    (params = {}, token) => {
      const p = new URLSearchParams()
      if (params.category) p.set('category', params.category)
      if (params.tag)      p.set('tag',      params.tag)
      if (params.since)    p.set('since',    params.since)
      if (params.limit)    p.set('limit',    String(params.limit))
      const qs = p.toString()
      return api.get(`/research/entries${qs ? `?${qs}` : ''}`, token)
    },
    getEntry:       (id, token) => api.get(`/research/entries/${id}`, token),
    publishEntry:   (id, token) => api.post(`/research/entries/${id}/publish`, {}, token),
    unpublishEntry: (id, token) => api.post(`/research/entries/${id}/unpublish`, {}, token),

    listCommunity:  (params = {}, token) => {
      const p = new URLSearchParams()
      if (params.tag)             p.set('tag', params.tag)
      if (params.limit)           p.set('limit', String(params.limit))
      if (params.cursorCreatedAt) p.set('cursorCreatedAt', params.cursorCreatedAt)
      if (params.cursorId)        p.set('cursorId', params.cursorId)
      const qs = p.toString()
      return api.get(`/research/community${qs ? `?${qs}` : ''}`, token)
    },
    // Returns text/markdown — caller should use the URL directly with a
    // <a download> attribute rather than this fetch wrapper.
    exportUrl:      () => `/api/v1/research/export.md`,

    // Sprint 2 — shareNotesWithGuide preference. Stored inside User.preferences
    // Json (no schema column); absent === default OFF.
    getPreferences:   (token)       => api.get('/research/preferences', token),
    patchPreferences: (body, token) => api.patch('/research/preferences', body, token),
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
    // A3b.10 — runtime resolver. Returns { gameId, algorithm, runtime }
    // where runtime is 'frontend' | 'backend-in-process' | 'worker'.
    // Public read; cached: no-store so admin matrix edits land immediately.
    getRuntime:       (gameId, algorithm) =>
      api.get(`/ml/runtime?gameId=${encodeURIComponent(gameId)}&algorithm=${encodeURIComponent(algorithm)}`),
    // A3b.8 — preset table for the no-knobs UI. Returns
    // { gameId, algorithm, presets: [{ name, iterations, expectedDurationMs }, …] }.
    getPresets:       (gameId, algorithm) =>
      api.get(`/ml/presets?gameId=${encodeURIComponent(gameId)}&algorithm=${encodeURIComponent(algorithm)}`),
    finishSession:    (id, b, tok) => api.post(`/ml/sessions/${id}/finish`, b, tok),
    getSessions:      (id)         => api.get(`/ml/models/${id}/sessions`),
    getSession:       (id)         => api.get(`/ml/sessions/${id}`),
    getEpisodes:      (id, page)   => api.get(`/ml/sessions/${id}/episodes?page=${page}&limit=500`),
    // A3b.7 — stacked W/D/L eval points written by the multi-curve eval
    // (A3a.7). One row per (episodeNum × opponentLabel) — frontend groups
    // by opponentLabel and renders one stacked-area chart per group.
    getMetrics:       (id)         => api.get(`/ml/sessions/${id}/metrics`),
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
    get:        (id, token)         => request('GET',    `/bots/${id}`, null, token),
    mine:       (token)             => request('GET',    '/bots/mine', null, token),
    checkName:  (name, token)       => request('GET',    `/bots/check-name?name=${encodeURIComponent(name)}`, null, token),
    /**
     * Phase C.2 — pick one active bot near the caller's ELO. Auth is
     * optional; guests get matched against a default rating of 1500.
     * Returns { botUserId, displayName, rating } on success, throws
     * on 404 NO_CANDIDATES when even the widened ±300 window is empty.
     */
    quickMatch: ({ gameId = 'tic-tac-toe', eloWindow = 100, token } = {}) => {
      const p = new URLSearchParams({ gameId, eloWindow: String(eloWindow) })
      return request('GET', `/bots/quick-match?${p}`, null, token)
    },
    create:     (body, token)       => request('POST',   '/bots', body, token),
    quickCreate:(body, token)       => request('POST',   '/bots/quick', body, token),
    update:     (id, body, token)   => request('PATCH',  `/bots/${id}`, body, token),
    delete:     (id, token)         => request('DELETE', `/bots/${id}`, null, token),
    resetElo:   (id, token)         => request('POST',   `/bots/${id}/reset-elo`, {}, token),
    trainQuick: (id, token)         => request('POST',   `/bots/${id}/train-quick`, {}, token),
    trainGuided:        (id, token)             => request('POST',   `/bots/${id}/train-guided`, {}, token),
    trainGuidedFinalize:(id, body, token)       => request('POST',   `/bots/${id}/train-guided/finalize`, body, token),
    // Phase 3.8 — Multi-Skill Bots: per-bot skill management. Body for `add`
    // is `{ gameId, algorithm, modelType? }`; the endpoint is idempotent on
    // (botId, gameId) so a second add returns the existing skill instead of
    // failing.
    skills: {
      add:    (botId, body, token)              => request('POST',   `/bots/${botId}/skills`, body, token),
      remove: (botId, skillId, token)           => request('DELETE', `/bots/${botId}/skills/${skillId}`, null, token),
    },
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
    getPerfVitals: (token, { window = '24h', env } = {}) => {
      const p = new URLSearchParams()
      p.set('window', window)
      if (env) p.set('env', env)
      return api.get(`/admin/health/perf/vitals?${p.toString()}`, token)
    },
    listPerfBaselines: (token)           => api.get('/admin/perf/baselines', token),
    getPerfBaseline:   (filename, token) => api.get(`/admin/perf/baselines/${encodeURIComponent(filename)}`, token),
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

    // ── Learnable Help System (Sprint 1) ────────────────────────────────
    help: {
      listDocs: (token, opts = {}) => {
        const p = new URLSearchParams()
        if (opts.status)   p.set('status',   opts.status)
        if (opts.category) p.set('category', opts.category)
        if (opts.limit)    p.set('limit',    opts.limit)
        if (opts.offset)   p.set('offset',   opts.offset)
        const qs = p.toString()
        return api.get(`/admin/help/docs${qs ? `?${qs}` : ''}`, token)
      },
      getDoc:    (id, token)             => api.get(`/admin/help/docs/${id}`, token),
      createDoc: (body, token)           => api.post('/admin/help/docs', body, token),
      updateDoc: (id, body, token)       => request('PUT', `/admin/help/docs/${id}`, body, token),
      archiveDoc: (id, token)            => request('DELETE', `/admin/help/docs/${id}`, null, token),
      reindex:   (docId, token)          => api.post(`/admin/help/reindex${docId ? `?docId=${docId}` : ''}`, {}, token),

      // ── Sprint 4 §4.1 + §4.2 — curation queue ────────────────────────
      listQueries: (token, opts = {}) => {
        const p = new URLSearchParams()
        if (opts.signal)                              p.set('signal',                 opts.signal)
        if (opts.category)                            p.set('category',               opts.category)
        if (opts.contentFilterTriggered !== undefined) p.set('contentFilterTriggered', String(opts.contentFilterTriggered))
        if (opts.unreviewed)                          p.set('unreviewed',             'true')
        if (opts.since)                               p.set('since',                  opts.since)
        if (opts.until)                               p.set('until',                  opts.until)
        if (opts.limit)                               p.set('limit',                  opts.limit)
        if (opts.offset)                              p.set('offset',                 opts.offset)
        const qs = p.toString()
        return api.get(`/admin/help/queries${qs ? `?${qs}` : ''}`, token)
      },
      getQuery:   (id, token)        => api.get(`/admin/help/queries/${id}`, token),
      markReviewed: (answerId, token) =>
        api.post(`/admin/help/answers/${answerId}/review`, {}, token),

      // §4.3 metrics dashboard
      getMetrics: (token, days) =>
        api.get(`/admin/help/metrics${days ? `?days=${days}` : ''}`, token),
    },
  },

  // ── /me endpoints ────────────────────────────────────────────────────
  me: {
    getRoles: (token) => api.get('/me/roles', token),
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
