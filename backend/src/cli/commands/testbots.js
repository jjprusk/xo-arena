import db from '../lib/db.js'
import { ok, fail } from '../lib/safety.js'

const VALID_LEVELS = ['novice', 'intermediate', 'advanced', 'master']
const DEFAULT_LEVEL = 'novice'

// Canonical test bot definitions — used by both the seed command and the
// tournament fill endpoint to identify / create them.
export const TEST_BOTS = [
  { username: 'testbot-alpha', displayName: 'TestBot Alpha' },
  { username: 'testbot-beta',  displayName: 'TestBot Beta'  },
  { username: 'testbot-gamma', displayName: 'TestBot Gamma' },
  { username: 'testbot-delta', displayName: 'TestBot Delta' },
]

export function botModelId(username, level = DEFAULT_LEVEL) {
  // testbot:<username>:<level> — unique per bot, difficulty extractable by parseBotModelId
  return `testbot:${username}:${level}`
}

export async function seedTestBots(level = DEFAULT_LEVEL, ownerIdentifier = null) {
  let ownerId = null
  if (ownerIdentifier) {
    const owner = await db.user.findFirst({
      where: {
        OR: [
          { username: ownerIdentifier },
          { email: ownerIdentifier },
          { id: ownerIdentifier },
        ],
        isBot: false,
      },
      select: { id: true, displayName: true },
    })
    if (!owner) throw new Error(`Owner not found: "${ownerIdentifier}"`)
    ownerId = owner.id
  }

  const results = []
  for (const bot of TEST_BOTS) {
    const modelId = botModelId(bot.username, level)
    const existing = await db.user.findUnique({ where: { username: bot.username } })
    if (existing) {
      await db.user.update({
        where: { id: existing.id },
        data: { botModelId: modelId, ...(ownerId !== null && { botOwnerId: ownerId }) },
      })
      results.push({ ...bot, botModelId: modelId, status: 'updated', id: existing.id, ownerId })
      continue
    }
    const created = await db.user.create({
      data: {
        username:      bot.username,
        email:         `${bot.username}@arena.test`,
        displayName:   bot.displayName,
        isBot:         true,
        botActive:     true,
        botModelId:    modelId,
        nameConfirmed: true,
        eloRating:     1200,
        ...(ownerId && { botOwnerId: ownerId }),
      },
    })
    results.push({ ...bot, botModelId: modelId, status: 'created', id: created.id, ownerId })
  }
  return results
}

async function deleteTestBots() {
  const usernames = TEST_BOTS.map(b => b.username)
  const deleted = await db.user.deleteMany({ where: { username: { in: usernames } } })
  return deleted.count
}

export function testbotsCommand(program) {
  program
    .command('test-bots')
    .description('Seed the 4 standard test bot accounts (idempotent)')
    .option('--level <level>', `Minimax difficulty: ${VALID_LEVELS.join('|')}`, DEFAULT_LEVEL)
    .option('--owner <user>', 'Assign bots to this user (username, email, or ID)')
    .option('--reset', 'Delete all test bot accounts instead of seeding')
    .action(async (opts) => {
      try {
        if (opts.reset) {
          const count = await deleteTestBots()
          ok(`Deleted ${count} test bot(s)`)
          return
        }

        if (!VALID_LEVELS.includes(opts.level)) {
          fail(`Invalid level "${opts.level}". Must be one of: ${VALID_LEVELS.join(', ')}`)
          return
        }

        const results = await seedTestBots(opts.level, opts.owner ?? null)
        for (const r of results) {
          const ownerNote = r.ownerId ? ` → owner ${r.ownerId}` : ''
          if (r.status === 'created') ok(`Created ${r.displayName} @ ${r.botModelId} (${r.id})${ownerNote}`)
          else console.log(`  → ${r.displayName} updated to ${r.botModelId} (${r.id})${ownerNote}`)
        }
      } catch (err) {
        fail(err.message)
      }
    })
}
