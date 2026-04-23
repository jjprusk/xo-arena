// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * On-demand QA e2e for Phase 3.7a template-based seed-bot flow:
 *
 *   1. Clone a persona into a new system bot with a custom display name →
 *      verify the clone appears in the system-bots list AND is seeded on
 *      the template.
 *   2. Clone the same persona again with a different name → a second
 *      distinct clone is created.
 *   3. Collision: cloning with a name that already exists among system
 *      bots returns 409.
 *   4. Reuse across templates: the existing-bot path seeds a clone created
 *      on template A onto template B.
 *   5. Delete guard: DELETE /api/v1/admin/bots/<built-in> returns 400.
 *      DELETE on a clone returns 204 and the clone disappears from the
 *      system-bots list.
 *
 * Not in the smoke suite — run on demand:
 *
 *   cd e2e && npx playwright test tournament-template-clone --project=chromium
 */

import { test, expect, request as playwrightRequest } from '@playwright/test'
import { signIn, fetchAuthToken, tournamentApi, backendAdminApi } from './helpers.js'

const LANDING_URL = process.env.LANDING_URL || 'http://localhost:5174'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000'

const haveAdmin = !!process.env.TEST_ADMIN_EMAIL && !!process.env.TEST_ADMIN_PASSWORD

test.describe('Template seed-bot clone flow — Phase 3.7a', () => {
  test.setTimeout(90_000)

  test('clone persona, reuse across templates, and built-in delete guard', async () => {
    test.skip(!haveAdmin, 'Set TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD')

    const adminCtx = await playwrightRequest.newContext({ baseURL: LANDING_URL })
    try {
      const adminPageLike = { context: () => ({ request: adminCtx }) }
      await signIn(adminPageLike, process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD, LANDING_URL)
      const token   = await fetchAuthToken(adminCtx, LANDING_URL)
      const api     = tournamentApi(LANDING_URL)
      const backend = backendAdminApi(BACKEND_URL)

      // ── Setup: create two TournamentTemplate rows via the stage-2
      // template-first endpoint.
      const uniq = `clone-${Date.now()}`
      const futureStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const baseBody = {
        game: 'xo', mode: 'BOT_VS_BOT', format: 'PLANNED', bracketType: 'SINGLE_ELIM',
        bestOfN: 1, minParticipants: 2, maxParticipants: 4,
        startMode: 'MANUAL',
        recurrenceInterval: 'WEEKLY', recurrenceStart: futureStart,
        isTest: true,
      }
      const tournA = await api.createTemplate({ request: adminCtx, token }, {
        ...baseBody, name: `E2E Clone A ${uniq}`, description: `clone test A (${uniq})`,
      })
      const tournB = await api.createTemplate({ request: adminCtx, token }, {
        ...baseBody, name: `E2E Clone B ${uniq}`, description: `clone test B (${uniq})`,
      })

      const cleanupUserIds = []  // clones to hard-delete at the end

      try {
        // ── Find Rusty's user id from the system-bots list.
        const sys0 = await backend.listBots({ request: adminCtx, token }, { systemOnly: true })
        const rusty = sys0.bots.find(b => b.displayName === 'Rusty')
        expect(rusty, 'built-in Rusty is present in systemOnly list').toBeDefined()

        // ── 1. Clone Rusty → "Rusty Jr A".
        const nameA = `Rusty Jr ${uniq} A`
        const r1 = await api.addTemplateSeed({ request: adminCtx, token }, tournA.id, {
          personaBotId: rusty.id, displayName: nameA,
        })
        expect(r1.status, 'first clone succeeds').toBe(201)
        expect(r1.body.user.displayName).toBe(nameA)
        cleanupUserIds.push(r1.body.user.id)

        // ── 2. Clone Rusty again with a different name → second distinct clone.
        const nameB = `Rusty Jr ${uniq} B`
        const r2 = await api.addTemplateSeed({ request: adminCtx, token }, tournA.id, {
          personaBotId: rusty.id, displayName: nameB,
        })
        expect(r2.status, 'second clone succeeds').toBe(201)
        expect(r2.body.user.id).not.toBe(r1.body.user.id)
        cleanupUserIds.push(r2.body.user.id)

        // Template A now lists both clones as seeds.
        const tplA = await api.getTemplate({ request: adminCtx, token }, tournA.id)
        const seedUserIds = new Set(tplA.template.seedBots.map(sb => sb.userId))
        expect(seedUserIds.has(r1.body.user.id)).toBe(true)
        expect(seedUserIds.has(r2.body.user.id)).toBe(true)

        // Both clones show up in the system-bots list.
        const sys1 = await backend.listBots({ request: adminCtx, token }, { systemOnly: true })
        const sysIds1 = new Set(sys1.bots.map(b => b.id))
        expect(sysIds1.has(r1.body.user.id)).toBe(true)
        expect(sysIds1.has(r2.body.user.id)).toBe(true)

        // ── 3. Collision: a third clone with an existing display name → 409.
        const r3 = await api.addTemplateSeed({ request: adminCtx, token }, tournA.id, {
          personaBotId: rusty.id, displayName: nameA,  // same as first clone
        })
        expect(r3.status, 'duplicate display name is rejected').toBe(409)

        // ── 4. Reuse the first clone on template B via the existing-bot path.
        const r4 = await api.addTemplateSeed({ request: adminCtx, token }, tournB.id, {
          userId: r1.body.user.id,
        })
        expect(r4.status, 'clone is reusable across templates').toBe(201)
        const tplB = await api.getTemplate({ request: adminCtx, token }, tournB.id)
        expect(tplB.template.seedBots.map(sb => sb.userId)).toContain(r1.body.user.id)

        // ── 5a. DELETE guard: the built-in Rusty cannot be deleted.
        const delRusty = await backend.deleteBot({ request: adminCtx, token }, rusty.id)
        expect(delRusty.status, 'built-in Rusty cannot be deleted').toBe(400)
        expect(String(delRusty.body?.error ?? '')).toMatch(/built-in/i)

        // Confirm Rusty is still there.
        const sys2 = await backend.listBots({ request: adminCtx, token }, { systemOnly: true })
        expect(sys2.bots.find(b => b.id === rusty.id), 'Rusty survived delete attempt').toBeDefined()

        // ── 5b. First detach the clone from both templates, then delete it.
        // (The seedBot FK to users is RESTRICT, so detach is required first.)
        expect(await api.removeTemplateSeed({ request: adminCtx, token }, tournA.id, r1.body.user.id)).toBe(200)
        expect(await api.removeTemplateSeed({ request: adminCtx, token }, tournB.id, r1.body.user.id)).toBe(200)

        const delClone = await backend.deleteBot({ request: adminCtx, token }, r1.body.user.id)
        expect(delClone.status, 'clone deletes normally').toBe(204)
        cleanupUserIds.splice(cleanupUserIds.indexOf(r1.body.user.id), 1)  // already gone

        const sys3 = await backend.listBots({ request: adminCtx, token }, { systemOnly: true })
        expect(sys3.bots.find(b => b.id === r1.body.user.id), 'deleted clone is gone').toBeUndefined()
      } finally {
        // Detach remaining clones from their templates, then best-effort cleanup.
        for (const uid of cleanupUserIds) {
          await api.removeTemplateSeed({ request: adminCtx, token }, tournA.id, uid).catch(() => {})
          await api.removeTemplateSeed({ request: adminCtx, token }, tournB.id, uid).catch(() => {})
          await backend.deleteBot({ request: adminCtx, token }, uid).catch(() => {})
        }
        await api.deleteTemplate({ request: adminCtx, token }, tournA.id).catch(() => {})
        await api.deleteTemplate({ request: adminCtx, token }, tournB.id).catch(() => {})
        await api.cancel({ request: adminCtx, token }, tournA.id).catch(() => {})
        await api.cancel({ request: adminCtx, token }, tournB.id).catch(() => {})
      }
    } finally {
      await adminCtx.dispose()
    }
  })
})
