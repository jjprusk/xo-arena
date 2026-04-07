/**
 * Thin API client for the tournament service.
 * Base URL from VITE_TOURNAMENT_URL (defaults to '' for same-origin proxy).
 * All auth via Authorization: Bearer <token> header.
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
  /**
   * GET /api/tournaments?status=...&game=...
   * params: { status?, game? }
   */
  list: (params = {}, token) => {
    const p = new URLSearchParams()
    if (params.status) p.set('status', params.status)
    if (params.game)   p.set('game', params.game)
    const qs = p.toString()
    return request('GET', `/api/tournaments${qs ? `?${qs}` : ''}`, undefined, token)
  },

  /** GET /api/tournaments/:id */
  get: (id, token) =>
    request('GET', `/api/tournaments/${id}`, undefined, token),

  /** POST /api/tournaments */
  create: (data, token) =>
    request('POST', '/api/tournaments', data, token),

  /** PATCH /api/tournaments/:id */
  update: (id, data, token) =>
    request('PATCH', `/api/tournaments/${id}`, data, token),

  /** POST /api/tournaments/:id/publish */
  publish: (id, token) =>
    request('POST', `/api/tournaments/${id}/publish`, {}, token),

  /** POST /api/tournaments/:id/cancel */
  cancel: (id, token) =>
    request('POST', `/api/tournaments/${id}/cancel`, {}, token),

  /** POST /api/tournaments/:id/start */
  start: (id, token) =>
    request('POST', `/api/tournaments/${id}/start`, {}, token),

  /** POST /api/tournaments/:id/register */
  register: (id, token) =>
    request('POST', `/api/tournaments/${id}/register`, {}, token),

  /** DELETE /api/tournaments/:id/register */
  withdraw: (id, token) =>
    request('DELETE', `/api/tournaments/${id}/register`, undefined, token),

  /** POST /api/matches/:matchId/complete */
  completeMatch: (matchId, data, token) =>
    request('POST', `/api/matches/${matchId}/complete`, data, token),

  /** GET /api/bot-matches/config */
  getBotMatchConfig: (token) =>
    request('GET', '/api/bot-matches/config', undefined, token),

  /** PATCH /api/bot-matches/config */
  updateBotMatchConfig: (data, token) =>
    request('PATCH', '/api/bot-matches/config', data, token),

  /** GET /api/bot-matches/status */
  getBotMatchStatus: (token) =>
    request('GET', '/api/bot-matches/status', undefined, token),

  // ─── Classification ─────────────────────────────────────────────────────────

  /** GET /api/classification/players?page=&limit=&tier= */
  getClassificationPlayers: ({ page = 1, limit = 50, tier } = {}, token) => {
    const p = new URLSearchParams({ page, limit })
    if (tier) p.set('tier', tier)
    return request('GET', `/api/classification/players?${p}`, undefined, token)
  },

  /** GET /api/classification/players/:userId */
  getPlayerClassification: (userId, token) =>
    request('GET', `/api/classification/players/${userId}`, undefined, token),

  /** POST /api/classification/players/:userId/override */
  overridePlayerTier: (userId, tier, token) =>
    request('POST', `/api/classification/players/${userId}/override`, { tier }, token),

  /** GET /api/classification/thresholds */
  getMeritThresholds: (token) =>
    request('GET', '/api/classification/thresholds', undefined, token),

  /** PUT /api/classification/thresholds */
  updateMeritThresholds: (bands, token) =>
    request('PUT', '/api/classification/thresholds', bands, token),

  /** GET /api/classification/config */
  getClassificationConfig: (token) =>
    request('GET', '/api/classification/config', undefined, token),

  /** PATCH /api/classification/config */
  updateClassificationConfig: (updates, token) =>
    request('PATCH', '/api/classification/config', updates, token),

  // ─── Recurring registration ─────────────────────────────────────────────────

  /** POST /api/recurring/:templateId/register */
  recurringRegister: (templateId, token) =>
    request('POST', `/api/recurring/${templateId}/register`, {}, token),

  /** DELETE /api/recurring/:templateId/register */
  recurringWithdraw: (templateId, token) =>
    request('DELETE', `/api/recurring/${templateId}/register`, undefined, token),

  /** GET /api/recurring/:templateId/registrations */
  listRecurringRegistrations: (templateId, token) =>
    request('GET', `/api/recurring/${templateId}/registrations`, undefined, token),
}
