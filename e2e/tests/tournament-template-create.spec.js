// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Phase 3.7a stage 2 — POST /api/tournaments/admin/templates sanity check.
 *
 * Verifies the template-first create path introduced in stage 2:
 *
 *   1. Happy path — template row created, sibling Tournament row created
 *      with matching id and templateId = template.id, DRAFT status.
 *   2. Required fields — missing `recurrenceInterval` → 400.
 *   3. AUTO-mode anchor fallback — template with registrationCloseAt but
 *      no startTime / recurrenceStart still succeeds (anchor falls back).
 *
 * Run on demand:
 *   cd e2e && npx playwright test tournament-template-create --project=chromium
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import { signIn, fetchAuthToken, tournamentApi } from './helpers.js'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'

const haveAdmin = !!process.env.TEST_ADMIN_EMAIL && !!process.env.TEST_ADMIN_PASSWORD

test.describe('POST /admin/templates — Phase 3.7a stage 2', () => {
  test.setTimeout(60_000)

  test('happy path + validation branches', async () => {
    test.skip(!haveAdmin, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD')

    const adminCtx = await playwrightRequest.newContext({ baseURL: LANDING_URL })
    try {
      const adminPageLike = { context: () => ({ request: adminCtx }) }
      await signIn(adminPageLike, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, LANDING_URL)
      const token = await fetchAuthToken(adminCtx, LANDING_URL)
      const api   = tournamentApi(LANDING_URL)
      const hdr   = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

      const uniq = `tpl-${Date.now()}`
      const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const base = {
        name: `E2E Template Create ${uniq}`,
        description: 'stage 2 sanity',
        game: 'xo', mode: 'MIXED', format: 'PLANNED', bracketType: 'SINGLE_ELIM',
        bestOfN: 1, minParticipants: 2, maxParticipants: 4,
        startMode: 'MANUAL',
        recurrenceInterval: 'DAILY',
        isTest: true,
      }

      const createdIds = []
      try {
        // ── 1. Happy path.
        const tpl1 = await api.createTemplate({ request: adminCtx, token }, {
          ...base, recurrenceStart: futureStart,
        })
        createdIds.push(tpl1.id)
        expect(tpl1.id).toBeTruthy()
        expect(tpl1.name).toBe(base.name)
        expect(tpl1.recurrenceInterval).toBe('DAILY')

        // Sibling Tournament row exists with same id and templateId.
        const siblingRes = await adminCtx.get(`/api/tournaments/${tpl1.id}`, { headers: hdr })
        expect(siblingRes.ok()).toBe(true)
        const { tournament } = await siblingRes.json()
        expect(tournament.id).toBe(tpl1.id)
        expect(tournament.templateId).toBe(tpl1.id)
        expect(tournament.status).toBe('DRAFT')

        // ── 2. Missing recurrenceInterval → 400.
        const badRes = await adminCtx.post('/api/tournaments/admin/templates', {
          headers: hdr,
          data:    { ...base, name: `${base.name} bad`, recurrenceStart: futureStart, recurrenceInterval: undefined },
        })
        expect(badRes.status()).toBe(400)

        // ── 3. AUTO-mode anchor fallback — no recurrenceStart, but
        // registrationCloseAt provided → scheduler anchor falls back.
        const futureClose = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
        const tpl3 = await api.createTemplate({ request: adminCtx, token }, {
          ...base,
          name: `${base.name} AUTO`,
          startMode: 'AUTO',
          recurrenceStart: undefined,
          registrationCloseAt: futureClose,
        })
        createdIds.push(tpl3.id)
        expect(tpl3.recurrenceStart).toBeTruthy()
      } finally {
        for (const id of createdIds) {
          await api.deleteTemplate({ request: adminCtx, token }, id).catch(() => {})
        }
      }
    } finally {
      await adminCtx.dispose()
    }
  })
})
