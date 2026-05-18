import { describe, it, expect, vi } from 'vitest'
import { validateGameSlug } from '../gameSlug.js'

function makeRes() {
  return {
    statusCode: 200,
    body:       null,
    status(code) { this.statusCode = code; return this },
    json(body)  { this.body = body; return this },
  }
}

describe('tournament: validateGameSlug middleware', () => {
  it('accepts canonical slug tic-tac-toe', () => {
    const req  = { params: { slug: 'tic-tac-toe' }, query: {} }
    const res  = makeRes()
    const next = vi.fn()
    validateGameSlug(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.gameId).toBe('tic-tac-toe')
  })

  it('normalizes legacy xo alias to canonical tic-tac-toe', () => {
    const req  = { params: { slug: 'xo' }, query: {} }
    const res  = makeRes()
    const next = vi.fn()
    validateGameSlug(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.gameId).toBe('tic-tac-toe')
  })

  it('404s on unknown slug with helpful body', () => {
    const req  = { params: { slug: 'poker' }, query: {} }
    const res  = makeRes()
    const next = vi.fn()
    validateGameSlug(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
    expect(res.body.error).toMatch(/Unknown game slug: poker/)
    expect(res.body.acceptedSlugs).toContain('tic-tac-toe')
  })
})
