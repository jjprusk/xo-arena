/**
 * Tournament service API client for the aiarena landing app.
 * Mirrors frontend/src/lib/tournamentApi.js — single source until
 * this is extracted to packages/tournament-client.
 */

const BASE = import.meta.env.VITE_TOURNAMENT_URL ?? ''

async function request(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw Object.assign(new Error(err.error || 'Request failed'), { status: res.status })
  }
  if (res.status === 204) return null
  return res.json()
}

export const tournamentApi = {
  list: (params = {}, token) => {
    const p = new URLSearchParams()
    if (params.status) p.set('status', params.status)
    if (params.game)   p.set('game', params.game)
    const qs = p.toString()
    return request('GET', `/api/tournaments${qs ? `?${qs}` : ''}`, undefined, token)
  },
  get:      (id, token)         => request('GET',    `/api/tournaments/${id}`, undefined, token),
  create:   (data, token)       => request('POST',   '/api/tournaments', data, token),
  update:   (id, data, token)   => request('PATCH',  `/api/tournaments/${id}`, data, token),
  publish:  (id, token)         => request('POST',   `/api/tournaments/${id}/publish`, {}, token),
  cancel:   (id, token)         => request('POST',   `/api/tournaments/${id}/cancel`, {}, token),
  start:    (id, token)         => request('POST',   `/api/tournaments/${id}/start`, {}, token),
  register: (id, token, body={})=> request('POST',   `/api/tournaments/${id}/register`, body, token),
  withdraw: (id, token)         => request('DELETE', `/api/tournaments/${id}/register`, undefined, token),
  completeMatch: (matchId, data, token) =>
    request('POST', `/api/matches/${matchId}/complete`, data, token),

  getClassificationPlayers: ({ page=1, limit=50, tier }={}, token) => {
    const p = new URLSearchParams({ page, limit })
    if (tier) p.set('tier', tier)
    return request('GET', `/api/classification/players?${p}`, undefined, token)
  },
  getMyClassification:    (token)         => request('GET',  '/api/classification/me', undefined, token),
  useDemotionOptOut:      (token)         => request('POST', '/api/classification/me/demotion-opt-out', {}, token),
  getPlayerClassification:(userId, token) => request('GET',  `/api/classification/players/${userId}`, undefined, token),
  overridePlayerTier:     (userId, tier, token) =>
    request('POST', `/api/classification/players/${userId}/override`, { tier }, token),
  getMeritThresholds:     (token) => request('GET',  '/api/classification/thresholds', undefined, token),
  updateMeritThresholds:  (bands, token) => request('PUT', '/api/classification/thresholds', bands, token),
  getClassificationConfig:(token) => request('GET',  '/api/classification/config', undefined, token),
  updateClassificationConfig:(updates, token) => request('PATCH', '/api/classification/config', updates, token),

  recurringRegister:            (templateId, token) => request('POST',   `/api/recurring/${templateId}/register`, {}, token),
  recurringWithdraw:            (templateId, token) => request('DELETE', `/api/recurring/${templateId}/register`, undefined, token),
  listRecurringRegistrations:   (templateId, token) => request('GET',    `/api/recurring/${templateId}/registrations`, undefined, token),

  getBotMatchConfig:    (token)       => request('GET',   '/api/bot-matches/config', undefined, token),
  updateBotMatchConfig: (data, token) => request('PATCH', '/api/bot-matches/config', data, token),
  getBotMatchStatus:    (token)       => request('GET',   '/api/bot-matches/status', undefined, token),
}
