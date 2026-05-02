// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * dbScript — run a one-shot Prisma script inside the backend container.
 *
 * The DB hostname (`postgres`) isn't reachable from the Playwright host, so
 * tests that need direct DB access (cleanup, SystemConfig tunes, FK probes)
 * ship the script into the backend container and exec it there. This module
 * is the single shared implementation; specs used to each carry their own
 * copy.
 *
 *   runDbScript(`await db.user.deleteMany(...)`)               // fire and forget
 *   runDbScript(`...console.log(JSON.stringify(rows))`)        // capture stdout
 *
 * `body` is the inside of an async IIFE — it has access to a `db` (Prisma)
 * handle imported from /app/backend/src/lib/db.js.
 *
 * Silent-fail by design: if docker isn't reachable, returns `{ ok: false,
 * stdout: '', stderr: '<msg>' }`. Tests still surface their own assertion
 * errors clearly when the cleanup is best-effort.
 */
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROJECT_ROOT = '/Users/joe/Desktop/xo-arena'

export function runDbScript(body, { tag = 'db' } = {}) {
  const script = `(async () => {
    process.stdout.write('SCRIPT_START\\n');
    try {
      const db = (await import('/app/backend/src/lib/db.js')).default;
      ${body}
      process.stdout.write('\\nSCRIPT_END\\n');
      await new Promise(r => setTimeout(r, 100));
      process.exit(0);
    } catch (e) {
      process.stdout.write('SCRIPT_ERROR ' + e.message + '\\n');
      await new Promise(r => setTimeout(r, 100));
      process.exit(0);
    }
  })()`
  const dir = mkdtempSync(join(tmpdir(), `e2e-${tag}-`))
  const localPath = join(dir, 'script.mjs')
  writeFileSync(localPath, script)
  const remotePath = `/tmp/e2e-${tag}-script.mjs`
  try {
    execSync(`docker compose cp "${localPath}" backend:${remotePath}`, {
      stdio: 'pipe', timeout: 15_000, cwd: PROJECT_ROOT,
    })
    const out = execSync(`docker compose exec -T backend node ${remotePath}`, {
      stdio: 'pipe', timeout: 60_000, cwd: PROJECT_ROOT,
    })
    return { ok: true, stdout: out?.toString() ?? '', stderr: '' }
  } catch (e) {
    return {
      ok:     false,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? e.message ?? '',
    }
  }
}

/**
 * Net-sweep cleanup keyed on a BetterAuth email prefix. Drops every artifact
 * a journey/idle test could plausibly create on behalf of users matching
 * `BaUser.email LIKE '<emailPrefix>%'`:
 *
 *   - Tournaments + matches + games created by the user (incl. cup clones)
 *   - Tables (private demo + open) the user created
 *   - Bots owned by the user (User where botOwnerId in user ids)
 *   - BotSkill rows + cascaded TrainingSession rows for those bots
 *   - BotSkill rows where createdBy = userId (skill rows not yet bound to a bot)
 *   - Games where the user (or any of their bots) was player1/player2/winner
 *   - TournamentParticipant rows for those bots
 *   - UserNotification, NotificationPreference, PushSubscription
 *   - GameElo, UserEloHistory, MeritTransaction, ClassificationHistory,
 *     PlayerClassification, RecurringTournamentRegistration
 *   - The application User row, then BaUser
 *
 * Idempotent and safe to run multiple times. Any FK that's tied to the User
 * via @relation cascade is dropped automatically when the User goes — but
 * several relations are *soft* FKs (BotSkill.botId, BotSkill.createdBy) so we
 * delete them explicitly first.
 *
 * Pass the actual email prefix used by the spec (e.g. `'onb+'`, `'gui+'`,
 * `'idle+'`) — the trailing `%` is added automatically.
 */
export function netCleanupByEmailPrefix(emailPrefix, { tag = 'sweep' } = {}) {
  const safe = String(emailPrefix).replace(/'/g, "''")
  const body = `
    const baRows = await db.baUser.findMany({
      where:  { email: { startsWith: '${safe}' } },
      select: { id: true, email: true },
    })
    const baIds = baRows.map(r => r.id)
    const baEmails = baRows.map(r => r.email)
    if (!baIds.length) {
      console.log('[netCleanup ${safe}] nothing to do')
      return
    }
    const users = await db.user.findMany({
      where:  { betterAuthId: { in: baIds } },
      select: { id: true },
    })
    const userIds = users.map(u => u.id)

    // 1. Bots owned by these users (User rows where botOwnerId in userIds).
    const ownedBots = userIds.length
      ? await db.user.findMany({ where: { botOwnerId: { in: userIds } }, select: { id: true } })
      : []
    const botIds = ownedBots.map(b => b.id)

    // 2. All actor ids — used for game / participant / classification cleanup.
    const allIds = [...userIds, ...botIds]

    // 3. Tournaments these users created (cup clones live here).
    const tourns = userIds.length
      ? await db.tournament.findMany({ where: { createdById: { in: userIds } }, select: { id: true } })
      : []
    const tournIds = tourns.map(t => t.id)
    if (tournIds.length) {
      await db.game.deleteMany({ where: { tournamentId: { in: tournIds } } }).catch(()=>{})
      await db.tournamentParticipant.deleteMany({ where: { tournamentId: { in: tournIds } } }).catch(()=>{})
      await db.tournament.deleteMany({ where: { id: { in: tournIds } } }).catch(()=>{})
    }

    // 3.5 TournamentTemplate cleanup. The recurring-tournament specs create
    // templates via admin endpoints; those templates have createdById set to
    // whichever admin user the spec authenticated as — usually NOT one of
    // the per-spec test users matched above. Without a broader sweep,
    // templates accumulate in the local DB across runs and the recurring
    // scheduler keeps spawning fresh occurrences (DAILY) every 60s, which
    // (a) hammers the DB with findFirst dedup queries and (b) starves the
    // bot game runner so the cup tests time out.
    //
    // Sweep both axes:
    //   - createdById in userIds (templates this run owned)
    //   - name LIKE 'E2E%'    (test-named, regardless of owner)
    //   - isTest = true       (admin-flagged test templates)
    // ...then cascade their spawned occurrences + child rows + the templates
    // themselves.
    const templates = await db.tournamentTemplate.findMany({
      where: {
        OR: [
          ...(userIds.length ? [{ createdById: { in: userIds } }] : []),
          { name: { startsWith: 'E2E' } },
          { isTest: true },
        ],
      },
      select: { id: true },
    })
    const templateIds = templates.map(t => t.id)
    if (templateIds.length) {
      // Spawned occurrences (one per recurrence tick) — clean them out
      // before the templates they back-ref to.
      const occurrences = await db.tournament.findMany({
        where: { templateId: { in: templateIds } },
        select: { id: true },
      })
      const occIds = occurrences.map(o => o.id)
      if (occIds.length) {
        await db.game.deleteMany({ where: { tournamentId: { in: occIds } } }).catch(()=>{})
        await db.tournamentMatch.deleteMany({ where: { tournamentId: { in: occIds } } }).catch(()=>{})
        await db.tournamentRound.deleteMany({ where: { tournamentId: { in: occIds } } }).catch(()=>{})
        await db.tournamentParticipant.deleteMany({ where: { tournamentId: { in: occIds } } }).catch(()=>{})
        await db.tournamentSeedBot.deleteMany({ where: { tournamentId: { in: occIds } } }).catch(()=>{})
        await db.table.deleteMany({ where: { tournamentId: { in: occIds } } }).catch(()=>{})
        await db.tournament.deleteMany({ where: { id: { in: occIds } } }).catch(()=>{})
      }
      // Template-side child rows.
      await db.tournamentTemplateSeedBot.deleteMany({ where: { templateId: { in: templateIds } } }).catch(()=>{})
      await db.recurringTournamentRegistration.deleteMany({ where: { templateId: { in: templateIds } } }).catch(()=>{})
      await db.tournamentTemplate.deleteMany({ where: { id: { in: templateIds } } }).catch(()=>{})
    }

    // 4. Cup-bot collateral: cup clones leave bot-cup-* User rows around even
    //    when the calling user is gone. Sweep them by username pattern.
    const cupBots = await db.user.findMany({
      where: { username: { startsWith: 'bot-cup-' } },
      select: { id: true },
    })
    const cupBotIds = cupBots.map(b => b.id)
    if (cupBotIds.length) {
      await db.game.deleteMany({ where: { OR: [
        { player1Id: { in: cupBotIds } },
        { player2Id: { in: cupBotIds } },
        { winnerId:  { in: cupBotIds } },
      ] } }).catch(()=>{})
      await db.tournamentParticipant.deleteMany({ where: { userId: { in: cupBotIds } } }).catch(()=>{})
      await db.botSkill.deleteMany({ where: { botId: { in: cupBotIds } } }).catch(()=>{})
      await db.user.deleteMany({ where: { id: { in: cupBotIds } } }).catch(()=>{})
    }

    // 5. Games involving the user or any of their bots.
    if (allIds.length) {
      await db.game.deleteMany({ where: { OR: [
        { player1Id: { in: allIds } },
        { player2Id: { in: allIds } },
        { winnerId:  { in: allIds } },
      ] } }).catch(()=>{})
      await db.tournamentParticipant.deleteMany({ where: { userId: { in: allIds } } }).catch(()=>{})
    }

    // 6. Tables the user created (demo + open).
    if (userIds.length) {
      await db.table.deleteMany({ where: { createdById: { in: userIds } } }).catch(()=>{})
    }

    // 7. BotSkill rows: bound to bot user, or created by test user but not
    //    yet bound. createdBy is a soft FK; both branches cascade
    //    TrainingSession via @relation onDelete: Cascade.
    if (botIds.length) {
      await db.botSkill.deleteMany({ where: { botId: { in: botIds } } }).catch(()=>{})
    }
    if (userIds.length) {
      await db.botSkill.deleteMany({ where: { createdBy: { in: userIds } } }).catch(()=>{})
    }

    // 8. Misc per-user rows that aren't auto-cascaded.
    if (allIds.length) {
      await db.gameElo.deleteMany({ where: { userId: { in: allIds } } }).catch(()=>{})
      await db.userEloHistory.deleteMany({ where: { userId: { in: allIds } } }).catch(()=>{})
      await db.userNotification.deleteMany({ where: { userId: { in: allIds } } }).catch(()=>{})
      await db.notificationPreference.deleteMany({ where: { userId: { in: allIds } } }).catch(()=>{})
      await db.pushSubscription.deleteMany({ where: { userId: { in: allIds } } }).catch(()=>{})
    }
    if (userIds.length) {
      await db.meritTransaction.deleteMany({ where: { userId: { in: userIds } } }).catch(()=>{})
      await db.classificationHistory.deleteMany({ where: { userId: { in: userIds } } }).catch(()=>{})
      await db.playerClassification.deleteMany({ where: { userId: { in: userIds } } }).catch(()=>{})
      await db.recurringTournamentRegistration.deleteMany({ where: { userId: { in: userIds } } }).catch(()=>{})
    }

    // 9. Drop the bot User rows then the test User rows.
    if (botIds.length) {
      await db.user.deleteMany({ where: { id: { in: botIds } } }).catch(()=>{})
    }
    if (userIds.length) {
      await db.user.deleteMany({ where: { id: { in: userIds } } }).catch(()=>{})
    }

    // 10. Finally the BetterAuth shell rows (sessions/accounts FK to BaUser
    //     and cascade automatically).
    await db.baUser.deleteMany({ where: { id: { in: baIds } } }).catch(()=>{})

    console.log('[netCleanup ${safe}] users=' + userIds.length +
      ' bots=' + botIds.length +
      ' cupBots=' + cupBotIds.length +
      ' tournaments=' + tournIds.length +
      ' templates=' + templateIds.length)
  `
  const result = runDbScript(body, { tag })
  if (!result.ok) {
    console.log(`[netCleanup ${emailPrefix}] FAILED:`, result.stderr.trim() || '(no stderr)')
  } else {
    const tail = result.stdout.split('\n').filter(Boolean).slice(-2).join(' ')
    console.log(`[netCleanup ${emailPrefix}]`, tail)
  }
  return result
}
