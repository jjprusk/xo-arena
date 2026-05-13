import { describe, it, expect } from 'vitest'
import { chunk } from '../chunker.js'

describe('help chunker', () => {
  it('returns empty array for empty input', () => {
    expect(chunk('')).toEqual([])
    expect(chunk(null)).toEqual([])
    expect(chunk(undefined)).toEqual([])
  })

  it('returns a single chunk for short content', () => {
    const out = chunk('# Title\n\nShort paragraph.')
    expect(out).toHaveLength(1)
    expect(out[0].position).toBe(0)
    expect(out[0].content).toContain('Short paragraph')
  })

  it('splits into multiple chunks when target exceeded', () => {
    const long = '## Section\n\n' + 'word '.repeat(400)
    const repeated = [long, long, long].join('\n\n')
    const out = chunk(repeated)
    expect(out.length).toBeGreaterThanOrEqual(2)
    out.forEach((c, i) => expect(c.position).toBe(i))
  })

  it('keeps headers with their paragraphs', () => {
    const body = '# H1\n\nPara 1.\n\n## H2\n\nPara 2.'
    const out = chunk(body)
    expect(out).toHaveLength(1)
    expect(out[0].content).toContain('# H1')
    expect(out[0].content).toContain('## H2')
  })

  it('assigns monotonic positions starting at 0', () => {
    const long = 'x'.repeat(900)
    const body = [long, long, long, long].join('\n\n')
    const out = chunk(body)
    expect(out.map(c => c.position)).toEqual(out.map((_, i) => i))
  })
})
