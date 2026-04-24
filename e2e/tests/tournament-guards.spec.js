// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Tournament runaway-loop guard smoke — API-only.
 *
 * Verifies the four runaway-loop guards added in v1.3.0-alpha-1.35
 * (commit 520928e) are live on the deployed tournament service:
 *
 *   A. Count exposure   — GET /api/tournaments includes gamesPlayed,
 *                         expectedGames, runawayRatio on every row.
 *   B. Expected bound   — expectedGames matches the bracketMath ceiling
 *                         for the tournament's bracketType + bestOfN +
 *                         participant count.
 *   C. Auto-cancel      — no IN_PROGRESS tournament sits above the 5x
 *                         cancel threshold (would indicate the sweep is
 *                         failing to kill runaway loops).
 *   D. In-flight widget — covered by the above: the widget is a view
 *                         over the same fields; if the API is correct,
 *                         the widget has the data it needs.
 *
 * Intentionally does NOT attempt to trigger auto-cancel — that requires
 * forcing 500+ games and would be destructive to staging.
 *
 * Run (local):     ./scripts/run-qa.sh tournament-guards
 * Run (staging):   TOURNAMENT_URL=https://xo-tournament-staging.fly.dev \
 *                  LANDING_URL=https://xo-landing-staging.fly.dev \
 *                  npx playwright test tournament-guards --project=chromium
 */

import { test, expect } from '@playwright/test'

const TOURNAMENT_URL = process.env.TOURNAMENT_URL || 'http://localhost:3001'

// Mirror of tournament/src/lib/bracketMath.js — keep these two
// constants in sync with that file.
const RUNAWAY_CANCEL_RATIO = 5

function expectedMatchCount(bracketType, n) {
  if (!n || n < 2) return 0
  switch (bracketType) {
    case 'SINGLE_ELIM': return n - 1
    case 'ROUND_ROBIN': return (n * (n - 1)) / 2
    default:            return n - 1
  }
}

test.describe('Tournament runaway-loop guards — smoke', () => {
  test('GET /api/tournaments exposes gamesPlayed / expectedGames / runawayRatio on every row', async ({ request }) => {
    const res = await request.get(`${TOURNAMENT_URL}/api/tournaments?includeTest=true`)
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(Array.isArray(body.tournaments)).toBe(true)

    for (const t of body.tournaments) {
      // Guard A — fields present and numeric.
      expect(typeof t.gamesPlayed,   `${t.id} gamesPlayed`).toBe('number')
      expect(typeof t.expectedGames, `${t.id} expectedGames`).toBe('number')
      expect(typeof t.runawayRatio,  `${t.id} runawayRatio`).toBe('number')
      expect(Number.isFinite(t.runawayRatio)).toBe(true)
      expect(t.gamesPlayed).toBeGreaterThanOrEqual(0)
      expect(t.expectedGames).toBeGreaterThanOrEqual(0)
      expect(t.runawayRatio).toBeGreaterThanOrEqual(0)
    }
  })

  test('runawayRatio = gamesPlayed / expectedGames (or 0 when no games expected)', async ({ request }) => {
    const res = await request.get(`${TOURNAMENT_URL}/api/tournaments?includeTest=true`)
    const { tournaments } = await res.json()

    for (const t of tournaments) {
      if (t.expectedGames === 0) {
        // No bracket generated yet (DRAFT / REGISTRATION_OPEN with 0-1
        // participants) — the service emits 0 rather than NaN.
        expect(t.runawayRatio, `${t.id} runawayRatio with expectedGames=0`).toBe(0)
      } else {
        const computed = t.gamesPlayed / t.expectedGames
        expect(t.runawayRatio).toBeCloseTo(computed, 6)
      }
    }
  })

  test('expectedGames matches bracketMath ceiling for each tournament', async ({ request }) => {
    // The list endpoint does not include participant count in the public
    // projection, so we fetch each tournament's detail to get the real
    // count. Limited to IN_PROGRESS + COMPLETED so we don't spam requests
    // against a staging list with dozens of drafts.
    const listRes = await request.get(`${TOURNAMENT_URL}/api/tournaments?includeTest=true`)
    const { tournaments } = await listRes.json()
    const checkable = tournaments.filter(t => t.status === 'IN_PROGRESS' || t.status === 'COMPLETED')

    if (checkable.length === 0) {
      test.skip(true, 'No IN_PROGRESS or COMPLETED tournaments to verify bracket math against')
    }

    for (const t of checkable.slice(0, 20)) {
      const detailRes = await request.get(`${TOURNAMENT_URL}/api/tournaments/${t.id}`)
      expect(detailRes.ok(), `detail for ${t.id}`).toBe(true)
      const { tournament } = await detailRes.json()
      const participantCount = (tournament.participants ?? []).length
      const bon = Math.max(1, tournament.bestOfN ?? 1)
      const expected = expectedMatchCount(tournament.bracketType, participantCount) * bon
      expect(t.expectedGames, `${t.id} (${tournament.bracketType}, ${participantCount}p, bo${bon})`).toBe(expected)
    }
  })

  test('no IN_PROGRESS tournament is above the 5x auto-cancel threshold', async ({ request }) => {
    // This is the "is the sweep actually doing its job?" check.
    // If a tournament sits above 5x while IN_PROGRESS, either the sweep
    // is not running or Phase 4 is silently failing — both are the exact
    // scenarios these guards exist to catch.
    const res = await request.get(`${TOURNAMENT_URL}/api/tournaments?includeTest=true&status=IN_PROGRESS`)
    const { tournaments } = await res.json()

    const runaways = tournaments.filter(t => t.runawayRatio > RUNAWAY_CANCEL_RATIO)
    expect(runaways, `Runaway tournaments above ${RUNAWAY_CANCEL_RATIO}x: ${runaways.map(t => `${t.id} @ ${t.runawayRatio.toFixed(1)}x`).join(', ')}`).toEqual([])
  })
})
