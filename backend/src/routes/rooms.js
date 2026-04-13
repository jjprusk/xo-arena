// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { Router } from 'express'
import { optionalAuth } from '../middleware/auth.js'
import { roomManager } from '../realtime/roomManager.js'
import { MountainNamePool } from '../realtime/mountainNames.js'
import { botGameRunner } from '../realtime/botGameRunner.js'

const router = Router()

/**
 * POST /api/v1/rooms
 * Creates a room reservation (before socket connects).
 * Returns the slug the client should use when connecting via socket.
 * Used for sharing invite links before the host's socket is ready.
 */
router.post('/', optionalAuth, (req, res) => {
  const { spectatorAllowed = true } = req.body

  // We create a room with a temporary placeholder host ID
  // The socket handler will adopt this room on connection
  try {
    const name = roomManager._pool.acquire()
    if (!name) return res.status(503).json({ error: 'No rooms available' })

    const slug = MountainNamePool.toSlug(name)
    res.json({
      slug,
      displayName: `Mt. ${name}`,
      inviteUrl: `/room/${slug}`,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/v1/rooms/:slug
 * Look up room status by mountain slug.
 */
router.get('/:slug', (req, res) => {
  const room = roomManager.getRoom(req.params.slug)
  if (room) {
    return res.json({
      room: {
        slug: room.slug,
        displayName: room.displayName,
        status: room.status,
        spectatorAllowed: room.spectatorAllowed,
        spectatorCount: room.spectatorIds.size,
      },
    })
  }

  const botGame = botGameRunner.getGame(req.params.slug)
  if (botGame) {
    return res.json({
      room: {
        slug: botGame.slug,
        displayName: botGame.displayName,
        status: botGame.status,
        spectatorAllowed: true,
        spectatorCount: botGame.spectatorIds.size,
        isBotGame: true,
        bot1: { displayName: botGame.bot1.displayName, mark: 'X' },
        bot2: { displayName: botGame.bot2.displayName, mark: 'O' },
      },
    })
  }

  return res.status(404).json({ error: 'Room not found' })
})

/**
 * GET /api/v1/rooms
 * List active rooms (waiting to join or live to spectate).
 */
router.get('/', (_req, res) => {
  const pvpRooms = roomManager.listRooms()
  const botGames = botGameRunner.listGames()
  res.json({ rooms: [...pvpRooms, ...botGames] })
})

export default router
