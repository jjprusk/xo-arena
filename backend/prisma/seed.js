/**
 * Database seed — idempotent, safe to re-run.
 *
 * Seeds:
 *  1. System config defaults (bot limits, calibration count)
 *  2. System account (owner of built-in bots)
 *  3. Built-in bot personas: Rusty, Copper, Sterling, Magnus
 */

import db from '@xo-arena/db'
import { fileURLToPath } from 'url'

// ─── System config defaults ────────────────────────────────────────────────

const CONFIG_DEFAULTS = [
  { key: 'bots.defaultBotLimit',       value: 5   },
  { key: 'bots.calibrationGamesTotal', value: 12  },
  { key: 'game.idleWarnSeconds',        value: 120 },
  { key: 'game.idleGraceSeconds',       value: 60  },
  { key: 'game.spectatorIdleSeconds',   value: 600 },
  { key: 'session.idleWarnMinutes',     value: 30  },
  { key: 'session.idleGraceMinutes',    value: 5   },

  // Intelligent Guide v1 — admin-tunable defaults (Intelligent_Guide_Requirements.md §8.4)
  { key: 'guide.rewards.hookComplete',        value: 20  },  // TC at end-of-Hook (step 2)
  { key: 'guide.rewards.curriculumComplete',  value: 50  },  // TC at end-of-Curriculum (step 7)
  { key: 'guide.quickBot.defaultTier',        value: 'novice' },        // Quick Bot starting tier — Rusty-equivalent
  { key: 'guide.quickBot.firstTrainingTier',  value: 'intermediate' },  // Tier after first training run — Copper-equivalent

  // Discovery rewards — Sprint 5 (Intelligent_Guide_Requirements.md §5.7 / §8.4).
  // One-shot grants outside the linear journey; idempotent per user.
  { key: 'guide.rewards.discovery.firstSpecializeAction',    value: 10 },
  { key: 'guide.rewards.discovery.firstRealTournamentWin',   value: 25 },
  { key: 'guide.rewards.discovery.firstNonDefaultAlgorithm', value: 10 },
  { key: 'guide.rewards.discovery.firstTemplateClone',       value: 10 },

  // Metrics pollution prevention — Sprint 5 (Intelligent_Guide_Requirements.md §2 / §8.4).
  // Email domains here cause new accounts to be flagged isTestUser=true on
  // creation. Admin opt-in toggle in Settings can override per-user later.
  // Default empty — site operator fills in via admin UI / um CLI.
  { key: 'metrics.internalEmailDomains', value: [] },

  // Cup + demo + flag — Sprint 6 (§8.4). Migrating these from in-code
  // constants so the admin SystemConfig UI can tune them without a deploy.
  // guide.cup.sizeEntrants is reserved/informational in v1 — the cup spawns
  // with a fixed 4-bot bracket (caller + 3 opponents) because the opponent
  // mix is part of the curriculum design. v1.1 wires it as a true tunable.
  { key: 'guide.cup.sizeEntrants',  value: 4  },
  { key: 'guide.cup.retentionDays', value: 30 },
  { key: 'guide.demo.ttlMinutes',   value: 60 },
  // V1 release gate. Default true so dev/staging keep working as-is; the
  // production deploy seeds this off, then admin flips on once metrics
  // dashboards confirm a healthy first-day funnel. When off, the journey
  // step + discovery-reward grant calls become no-ops — the rest of the
  // platform (games, bots, tournaments) still works.
  { key: 'guide.v1.enabled',        value: true },
]

// ─── Built-in bot definitions ──────────────────────────────────────────────

export const BUILT_IN_BOTS = [
  {
    username:     'bot-rusty',
    email:        'bot.rusty@xo-arena.internal',
    displayName:  'Rusty',
    botModelType: 'minimax',
    botModelId:   'builtin:minimax:novice',
    botCompetitive: true,
  },
  {
    username:     'bot-copper',
    email:        'bot.copper@xo-arena.internal',
    displayName:  'Copper',
    botModelType: 'minimax',
    botModelId:   'builtin:minimax:intermediate',
    botCompetitive: true,
  },
  {
    username:     'bot-sterling',
    email:        'bot.sterling@xo-arena.internal',
    displayName:  'Sterling',
    botModelType: 'minimax',
    botModelId:   'builtin:minimax:advanced',
    botCompetitive: true,
  },
  {
    username:     'bot-magnus',
    email:        'bot.magnus@xo-arena.internal',
    displayName:  'Magnus',
    botModelType: 'minimax',
    botModelId:   'builtin:minimax:master',
    botCompetitive: true,
  },
]

// Names that cannot be used for user-created bots (display names of built-ins)
export const RESERVED_BOT_NAMES = BUILT_IN_BOTS.map(b => b.displayName.toLowerCase())

async function main() {
  try {
    // 1. System config defaults — only set if not already present
    for (const { key, value } of CONFIG_DEFAULTS) {
      await db.systemConfig.upsert({
        where:  { key },
        update: {},  // never overwrite — admin changes should persist across re-seeds
        create: { key, value },
      })
    }
    console.log('✓ System config defaults')

    // 2. System account — the owner of all built-in bots. Flagged
    // isTestUser=true per §2 metrics-pollution prevention so any stray
    // activity attributed to it is excluded from dashboards.
    const systemAccount = await db.user.upsert({
      where:  { username: 'system' },
      update: { isTestUser: true },
      create: {
        username:    'system',
        email:       'system@xo-arena.internal',
        displayName: 'System',
        isTestUser:  true,
      },
    })
    console.log('✓ System account:', systemAccount.id)

    // 3. Built-in bots
    for (const bot of BUILT_IN_BOTS) {
      await db.user.upsert({
        where:  { username: bot.username },
        update: {
          // Keep competitive flag and model type in sync with seed definition
          botCompetitive: bot.botCompetitive,
          botModelType:   bot.botModelType,
        },
        create: {
          username:       bot.username,
          email:          bot.email,
          displayName:    bot.displayName,
          isBot:          true,
          botModelType:   bot.botModelType,
          botModelId:     bot.botModelId,
          botOwnerId:     null,  // owned by system (no user FK — system account is separate)
          botActive:      true,
          botCompetitive: bot.botCompetitive,
          botAvailable:   true,
        },
      })
      console.log('✓ Bot:', bot.displayName)
    }
  } finally {
    await db.$disconnect()
  }
}

// Export for programmatic use (e.g. server startup)
export { main as runSeed }

// Only execute when run directly (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1) })
}
