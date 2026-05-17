import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'

import { validateGameSlug } from '../gameSlug.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/games/:slug/echo',
    validateGameSlug,
    (req, res) => {
      res.json({
        gameId:       req.gameId,
        queryGameId:  req.query.gameId,
        slugParam:    req.params.slug,
      })
    },
  )
  return app
}

describe('tournament: validateGameSlug middleware', () => {
  it('accepts canonical slug xo', async () => {
    const res = await request(buildApp()).get('/api/games/xo/echo')
    expect(res.status).toBe(200)
    expect(res.body.gameId).toBe('xo')
  })

  it('normalizes tic-tac-toe alias to canonical xo', async () => {
    const res = await request(buildApp()).get('/api/games/tic-tac-toe/echo')
    expect(res.status).toBe(200)
    expect(res.body.gameId).toBe('xo')
  })

  it('404s on unknown slug with helpful body', async () => {
    const res = await request(buildApp()).get('/api/games/poker/echo')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Unknown game slug: poker/)
    expect(res.body.acceptedSlugs).toContain('xo')
  })
})
