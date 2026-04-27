// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { describe, it, expect, vi } from 'vitest'
import {
  findOwnedBots,
  deleteBot,
  deleteUserWithBots,
  BuiltinBotProtectedError,
} from '../userDeletionService.js'

function makeTx() {
  const calls = []
  const trace = (label) => vi.fn((args) => {
    calls.push([label, args])
    return Promise.resolve(args && Array.isArray(args.where?.id?.in) ? { count: args.where.id.in.length } : { count: 1 })
  })
  return {
    calls,
    botSkill: { deleteMany: trace('botSkill.deleteMany') },
    baUser:   { delete:     trace('baUser.delete') },
    user:     { delete:     trace('user.delete') },
    game: {
      updateMany: trace('game.updateMany'),
      deleteMany: trace('game.deleteMany'),
    },
  }
}

function makeDb(tx) {
  return { $transaction: vi.fn(async (fn) => fn(tx)) }
}

describe('findOwnedBots', () => {
  it('queries User with botOwnerId + isBot filter and selects fields needed by the cascade', async () => {
    const db = { user: { findMany: vi.fn().mockResolvedValue([]) } }
    await findOwnedBots(db, 'usr_human')
    expect(db.user.findMany).toHaveBeenCalledWith({
      where:  { botOwnerId: 'usr_human', isBot: true },
      select: { id: true, username: true, displayName: true, betterAuthId: true, botModelId: true },
    })
  })
})

describe('deleteBot', () => {
  it('cascades games (nullify p2/winner, delete p1), bot skills (botId + botModelId), BaUser, then User', async () => {
    const tx = makeTx()
    const db = makeDb(tx)
    const bot = {
      id: 'bot_1',
      username: 'my-bot',
      betterAuthId: 'ba_bot_1',
      botModelId: 'skill_legacy',
    }

    await deleteBot(db, bot)

    const labels = tx.calls.map(c => c[0])
    expect(labels).toEqual([
      'game.updateMany',          // player2Id → null
      'game.updateMany',          // winnerId  → null
      'game.deleteMany',          // player1Id rows
      'botSkill.deleteMany',      // by botId
      'botSkill.deleteMany',      // by id == botModelId (legacy)
      'baUser.delete',
      'user.delete',
    ])
    expect(tx.calls[0][1]).toEqual({ where: { player2Id: 'bot_1' }, data: { player2Id: null } })
    expect(tx.calls[1][1]).toEqual({ where: { winnerId:  'bot_1' }, data: { winnerId:  null } })
    expect(tx.calls[2][1]).toEqual({ where: { player1Id: 'bot_1' } })
    expect(tx.calls[3][1]).toEqual({ where: { botId: 'bot_1' } })
    expect(tx.calls[4][1]).toEqual({ where: { id: 'skill_legacy' } })
    expect(tx.calls[5][1]).toEqual({ where: { id: 'ba_bot_1' } })
    expect(tx.calls[6][1]).toEqual({ where: { id: 'bot_1' } })
  })

  it('skips legacy botModelId cleanup when bot has none', async () => {
    const tx = makeTx()
    await deleteBot(makeDb(tx), { id: 'b', username: 'b', betterAuthId: null, botModelId: null })
    expect(tx.calls.filter(c => c[0] === 'botSkill.deleteMany')).toHaveLength(1)
    expect(tx.calls.filter(c => c[0] === 'baUser.delete')).toHaveLength(0)
  })

  it('refuses to delete a built-in persona', async () => {
    const tx = makeTx()
    const db = makeDb(tx)
    await expect(deleteBot(db, { id: 'b', username: 'bot-rusty', betterAuthId: null, botModelId: null }))
      .rejects.toBeInstanceOf(BuiltinBotProtectedError)
    expect(tx.calls).toHaveLength(0)
  })
})

describe('deleteUserWithBots', () => {
  it('deletes each bot fully before touching the human, then deletes the human last', async () => {
    const tx = makeTx()
    const db = makeDb(tx)
    const user = { id: 'usr_human', username: 'alice', betterAuthId: 'ba_human' }
    const bots = [
      { id: 'bot_1', username: 'b1', betterAuthId: 'ba_b1', botModelId: null },
      { id: 'bot_2', username: 'b2', betterAuthId: null,    botModelId: 'skill_legacy' },
    ]

    await deleteUserWithBots(db, user, bots)

    const userDeletes = tx.calls.filter(c => c[0] === 'user.delete').map(c => c[1].where.id)
    expect(userDeletes).toEqual(['bot_1', 'bot_2', 'usr_human'])

    // Human BaUser must be deleted before the human User.
    const humanBaUserIdx = tx.calls.findIndex(c => c[0] === 'baUser.delete' && c[1].where.id === 'ba_human')
    const humanUserIdx   = tx.calls.findIndex(c => c[0] === 'user.delete'  && c[1].where.id === 'usr_human')
    expect(humanBaUserIdx).toBeGreaterThanOrEqual(0)
    expect(humanBaUserIdx).toBeLessThan(humanUserIdx)

    // Human's player1 games are deleted before the human User row.
    const humanGameDeleteIdx = tx.calls.findIndex(c => c[0] === 'game.deleteMany' && c[1].where.player1Id === 'usr_human')
    expect(humanGameDeleteIdx).toBeGreaterThanOrEqual(0)
    expect(humanGameDeleteIdx).toBeLessThan(humanUserIdx)
  })

  it('handles the no-bots case (just the human + their games + BaUser)', async () => {
    const tx = makeTx()
    const db = makeDb(tx)
    await deleteUserWithBots(db, { id: 'u', username: 'solo', betterAuthId: 'ba_u' }, [])
    expect(tx.calls.filter(c => c[0] === 'botSkill.deleteMany')).toHaveLength(0)
    const labels = tx.calls.map(c => c[0])
    expect(labels).toEqual([
      'game.updateMany', 'game.updateMany', 'game.deleteMany',
      'baUser.delete', 'user.delete',
    ])
  })

  it('skips human BaUser delete when betterAuthId is null', async () => {
    const tx = makeTx()
    await deleteUserWithBots(makeDb(tx), { id: 'u', username: 'g', betterAuthId: null }, [])
    expect(tx.calls.filter(c => c[0] === 'baUser.delete')).toHaveLength(0)
  })

  it('refuses if the targeted user is a built-in persona', async () => {
    const db = makeDb(makeTx())
    await expect(deleteUserWithBots(db, { id: 'b', username: 'bot-magnus', betterAuthId: null }, []))
      .rejects.toBeInstanceOf(BuiltinBotProtectedError)
  })

  it('runs everything inside a single $transaction', async () => {
    const tx = makeTx()
    const db = makeDb(tx)
    await deleteUserWithBots(db, { id: 'u', username: 'g', betterAuthId: null }, [])
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })
})
