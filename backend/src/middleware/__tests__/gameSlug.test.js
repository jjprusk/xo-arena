import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'

import { validateGameSlug } from '../gameSlug.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  // Simulate the real mount: validator runs first, then a tiny echo handler
  // that surfaces the resolved req.gameId so tests can assert the lift worked.
  app.use(
    '/api/v1/games/:slug/echo',
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

describe('validateGameSlug middleware', () => {
  it('accepts the canonical slug (tic-tac-toe) and lifts req.gameId', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/v1/games/tic-tac-toe/echo')
    expect(res.status).toBe(200)
    expect(res.body.gameId).toBe('tic-tac-toe')
    expect(res.body.queryGameId).toBe('tic-tac-toe')
  })

  it('accepts the legacy alias (xo) and normalizes to canonical', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/v1/games/xo/echo')
    expect(res.status).toBe(200)
    // resolveGameSlug normalizes legacy 'xo' to canonical 'tic-tac-toe' post-A1.5b
    expect(res.body.gameId).toBe('tic-tac-toe')
    expect(res.body.queryGameId).toBe('tic-tac-toe')
  })

  it('returns 404 with a helpful error body for unknown slugs', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/v1/games/poker/echo')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/Unknown game slug: poker/)
    expect(res.body.slug).toBe('poker')
    expect(Array.isArray(res.body.acceptedSlugs)).toBe(true)
    expect(res.body.acceptedSlugs).toContain('tic-tac-toe')
    expect(res.body.acceptedSlugs).toContain('xo')
  })

  it('returns 404 (with slug shown as null) when called without a slug param', async () => {
    const app = express()
    // Mount without :slug so req.params.slug is undefined — defensive case
    app.use('/no-slug', validateGameSlug, (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/no-slug')
    expect(res.status).toBe(404)
    expect(res.body.slug).toBeNull()
  })

  it('does not override req.query if it is already populated', async () => {
    const app = express()
    app.use('/api/v1/games/:slug/echo', validateGameSlug, (req, res) => {
      res.json({ gameId: req.gameId, queryGameId: req.query.gameId, other: req.query.other })
    })
    const res = await request(app).get('/api/v1/games/tic-tac-toe/echo?other=keepme')
    expect(res.status).toBe(200)
    expect(res.body.gameId).toBe('tic-tac-toe')
    expect(res.body.queryGameId).toBe('tic-tac-toe')  // injected
    expect(res.body.other).toBe('keepme')             // preserved
  })
})
