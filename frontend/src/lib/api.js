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
    move: (board, difficulty, player, implementation, modelId, explain = false) =>
      request('POST', `/ai/move${explain ? '?explain=true' : ''}`, { board, difficulty, player, implementation, modelId }),
  },

  ml: {
    listModels:       ()           => api.get('/ml/models'),
    createModel:      (body, tok)  => api.post('/ml/models', body, tok),
    getModel:         (id)         => api.get(`/ml/models/${id}`),
    updateModel:      (id, b, tok) => api.patch(`/ml/models/${id}`, b, tok),
    deleteModel:      (id, tok)    => request('DELETE', `/ml/models/${id}`, null, tok),
    resetModel:       (id, tok)    => api.post(`/ml/models/${id}/reset`, {}, tok),
    cloneModel:       (id, b, tok) => api.post(`/ml/models/${id}/clone`, b, tok),
    getQTable:        (id)         => api.get(`/ml/models/${id}/qtable`),
    explainMove:      (id, board)  => api.post(`/ml/models/${id}/explain`, { board }),
    train:            (id, b, tok) => api.post(`/ml/models/${id}/train`, b, tok),
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
  },

  rooms: {
    list: () => api.get('/rooms'),
  },

  users: {
    sync: (token) => api.post('/users/sync', {}, token),
    stats: (id) => api.get(`/users/${id}/stats`),
  },

  games: {
    record: (body, token) => api.post('/games', body, token),
  },

  logs: {
    ingest: (entries) => api.post('/logs', { entries }),
  },
}
