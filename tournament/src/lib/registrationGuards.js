// Copyright © 2026 Joe Pruskowski. All rights reserved.

/**
 * Phase 3.8.2.5 / 3.8.5.3 — guard rails for tournament registration.
 *
 * `assertBotHasSkillForGame` enforces that any bot entering a tournament
 * has a `BotSkill` row matching the tournament's `gameId`. Without this
 * the picker accepts a bot that, at match start, has no skill to dispatch
 * a move — a hard failure surfaced too late.
 *
 * The picker filters by `?gameId=` already; this is the defensive belt
 * for the cases the picker can't catch (admin-set rosters, direct API
 * callers, race with skill deletion).
 *
 * Shape mirrors the route's `res.status(...).json(...)` contract so the
 * caller can forward `result.body` verbatim. `db` is injected so the test
 * never reaches a real Prisma client.
 */
export async function assertBotHasSkillForGame({ db, userId, isBot, gameId }) {
  if (!isBot) return { ok: true }

  const skill = await db.botSkill.findFirst({
    where:  { botId: userId, gameId },
    select: { id: true },
  })
  if (skill) return { ok: true }

  return {
    ok:     false,
    status: 400,
    body:   {
      error: `Bot has no skill for "${gameId}" — add one in the Gym before registering`,
      code:  'NO_SKILL',
    },
  }
}
