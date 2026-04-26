// Copyright © 2026 Joe Pruskowski. All rights reserved.
//
// Centralized hard-delete for User rows. All four delete paths (admin user,
// admin bot, user self-delete, CLI `um delete`) route through here so the
// cascade rules stay in one place.
//
// Why this exists at all: two columns reference users without a Prisma FK —
// `User.botOwnerId` and `BotSkill.botId` — so deleting a user does not
// auto-cascade to their bots or those bots' skills. `Game.player1Id` is also
// NOT NULL with no `onDelete: Cascade`, so we have to nullify player2/winner
// and delete player1 games before the user row goes.

const BUILTIN_BOT_USERNAMES = new Set([
  'bot-rusty',
  'bot-copper',
  'bot-sterling',
  'bot-magnus',
])

const BUILTIN_BOT_MESSAGE =
  'Built-in system bots (Rusty, Copper, Sterling, Magnus) cannot be deleted — they are the cloning source for all seeded tournament bots.'

export class BuiltinBotProtectedError extends Error {
  constructor(username) {
    super(BUILTIN_BOT_MESSAGE)
    this.code = 'BUILTIN_BOT_PROTECTED'
    this.username = username
  }
}

export class UserOwnsBotsError extends Error {
  constructor(bots) {
    super(`User owns ${bots.length} bot${bots.length === 1 ? '' : 's'}; delete them first.`)
    this.code = 'USER_OWNS_BOTS'
    this.bots = bots
  }
}

/**
 * Pre-fetch a human user's owned bots. Use this before calling
 * `deleteUserWithBots` so the caller can decide whether to surface the bot
 * count, refuse the request, etc.
 */
export async function findOwnedBots(db, userId) {
  return db.user.findMany({
    where:  { botOwnerId: userId, isBot: true },
    select: { id: true, username: true, displayName: true, betterAuthId: true, botModelId: true },
  })
}

/**
 * Delete a single bot inside an existing Prisma transaction client.
 * Throws BuiltinBotProtectedError if the bot is one of the four built-in
 * personas — those are the cloning source for seeded tournament bots.
 */
export async function deleteBotInTx(tx, bot) {
  if (BUILTIN_BOT_USERNAMES.has(bot.username)) {
    throw new BuiltinBotProtectedError(bot.username)
  }
  // Game.player1Id is NOT NULL with no cascade.
  await tx.game.updateMany({ where: { player2Id: bot.id }, data: { player2Id: null } })
  await tx.game.updateMany({ where: { winnerId:  bot.id }, data: { winnerId:  null } })
  await tx.game.deleteMany({ where: { player1Id: bot.id } })
  // BotSkill.botId is FK-less. Also delete by id == botModelId to catch
  // legacy rows whose botId column was never backfilled.
  await tx.botSkill.deleteMany({ where: { botId: bot.id } })
  if (bot.botModelId) {
    await tx.botSkill.deleteMany({ where: { id: bot.botModelId } })
  }
  if (bot.betterAuthId) {
    // BaSession + BaAccount cascade via onDelete: Cascade on BaUser.
    await tx.baUser.delete({ where: { id: bot.betterAuthId } }).catch(() => {})
  }
  await tx.user.delete({ where: { id: bot.id } })
}

/**
 * Delete a single bot User row.
 */
export async function deleteBot(db, bot) {
  // Hoist the builtin check so we don't even open a transaction.
  if (BUILTIN_BOT_USERNAMES.has(bot.username)) {
    throw new BuiltinBotProtectedError(bot.username)
  }
  await db.$transaction(async (tx) => deleteBotInTx(tx, bot))
}

/**
 * Delete a human user and all of their owned bots in one transaction.
 * Caller must pre-fetch `bots` via `findOwnedBots`.
 *
 * Throws BuiltinBotProtectedError if the targeted user (or any owned bot)
 * is a built-in persona.
 */
export async function deleteUserWithBots(db, user, bots) {
  if (BUILTIN_BOT_USERNAMES.has(user.username)) {
    throw new BuiltinBotProtectedError(user.username)
  }
  await db.$transaction(async (tx) => {
    for (const bot of bots) {
      await deleteBotInTx(tx, bot)
    }
    await tx.game.updateMany({ where: { player2Id: user.id }, data: { player2Id: null } })
    await tx.game.updateMany({ where: { winnerId:  user.id }, data: { winnerId:  null } })
    await tx.game.deleteMany({ where: { player1Id: user.id } })
    if (user.betterAuthId) {
      await tx.baUser.delete({ where: { id: user.betterAuthId } }).catch(() => {})
    }
    await tx.user.delete({ where: { id: user.id } })
  })
}

export const _internal = { BUILTIN_BOT_USERNAMES, BUILTIN_BOT_MESSAGE }
