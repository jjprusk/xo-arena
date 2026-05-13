import { describe, it, expect } from 'vitest'
import { embedText, embedTexts, toPgVectorLiteral, EMBED_DIM } from '../embedClient.js'

describe('embedClient stub', () => {
  it('returns a 384-dim vector', async () => {
    const v = await embedText('how do I train a bot')
    expect(v).toHaveLength(EMBED_DIM)
  })

  it('is deterministic — same input → same vector', async () => {
    const a = await embedText('tournaments overview')
    const b = await embedText('tournaments overview')
    expect(a).toEqual(b)
  })

  it('L2-normalizes (magnitude ≈ 1) for non-empty input', async () => {
    const v = await embedText('quick bots training')
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(mag).toBeCloseTo(1, 5)
  })

  it('emits a sentinel vector for empty input (length preserved)', async () => {
    const v = await embedText('')
    expect(v).toHaveLength(EMBED_DIM)
    // The sentinel should be a non-zero finite vector.
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    expect(mag).toBeGreaterThan(0)
  })

  it('shared tokens → higher cosine similarity than disjoint ones', async () => {
    const a = await embedText('tournament bracket seeding')
    const b = await embedText('tournament cup playoff')
    const c = await embedText('zzzz qqqq xxxx wwww')
    const cos = (x, y) => x.reduce((s, _, i) => s + x[i] * y[i], 0)
    expect(cos(a, b)).toBeGreaterThan(cos(a, c))
  })

  it('embedTexts preserves input order', async () => {
    const out = await embedTexts(['alpha', 'beta'])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual(await embedText('alpha'))
    expect(out[1]).toEqual(await embedText('beta'))
  })

  it('toPgVectorLiteral formats correctly', () => {
    const v = new Array(EMBED_DIM).fill(0)
    v[0] = 0.5
    v[1] = -0.25
    const lit = toPgVectorLiteral(v)
    expect(lit.startsWith('[0.5,-0.25,0,')).toBe(true)
    expect(lit.endsWith(']')).toBe(true)
  })

  it('toPgVectorLiteral rejects wrong-length input', () => {
    expect(() => toPgVectorLiteral([1, 2, 3])).toThrow(/384/)
  })
})
