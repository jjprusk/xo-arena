/**
 * Tests for the help corpus seeder. Focus is on frontmatter parsing and
 * the additive-vs-skip behavior. DB calls are mocked — the integration of
 * INSERTs + pgvector binding is verified in 1.11 acceptance with a real DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs/promises BEFORE importing the seeder. We control readdir/readFile
// behavior via the exposed mocks below.
const mockReaddir = vi.fn()
const mockReadFile = vi.fn()
vi.mock('node:fs/promises', () => ({
  readdir: (...args) => mockReaddir(...args),
  readFile: (...args) => mockReadFile(...args),
}))

const mockHelpDoc = {
  findUnique: vi.fn(),
  create: vi.fn(),
}
const mockExecuteRaw = vi.fn()
vi.mock('../../../lib/db.js', () => ({
  default: {
    helpDoc: mockHelpDoc,
    $executeRaw: (...args) => mockExecuteRaw(...args),
  },
}))

vi.mock('../../../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn() },
}))

const { parseFrontmatter, seedCorpus } = await import('../corpusSeeder.js')

beforeEach(() => {
  mockReaddir.mockReset()
  mockReadFile.mockReset()
  mockHelpDoc.findUnique.mockReset()
  mockHelpDoc.create.mockReset()
  mockExecuteRaw.mockReset()
})

describe('parseFrontmatter', () => {
  it('parses minimal frontmatter', () => {
    const { meta, body } = parseFrontmatter(
      '---\nslug: foo\ntitle: Foo\ncategory: basics\n---\n\nBody here.'
    )
    expect(meta.slug).toBe('foo')
    expect(meta.title).toBe('Foo')
    expect(meta.category).toBe('basics')
    expect(body).toContain('Body here.')
  })

  it('parses array tags', () => {
    const { meta } = parseFrontmatter(
      '---\nslug: foo\ntitle: t\ncategory: c\ntags: [a, b, c]\n---\n\nBody.'
    )
    expect(meta.tags).toEqual(['a', 'b', 'c'])
  })

  it('parses booleans', () => {
    const { meta } = parseFrontmatter(
      '---\nslug: foo\ntitle: t\ncategory: c\nadmin_only: true\n---\n\nBody.'
    )
    expect(meta.admin_only).toBe(true)
  })

  it('preserves multi-paragraph body', () => {
    const { body } = parseFrontmatter(
      '---\nslug: foo\ntitle: t\ncategory: c\n---\n\nPara 1.\n\nPara 2.'
    )
    expect(body).toContain('Para 1.')
    expect(body).toContain('Para 2.')
  })

  it('throws when frontmatter is missing', () => {
    expect(() => parseFrontmatter('No frontmatter here'))
      .toThrow(/frontmatter missing/)
  })

  it('throws when frontmatter is unterminated', () => {
    expect(() => parseFrontmatter('---\nslug: foo\n\nbody but no closing'))
      .toThrow(/unterminated/)
  })

  it('ignores unrecognized lines silently (forward-compat)', () => {
    const { meta } = parseFrontmatter(
      '---\nslug: foo\ntitle: t\ncategory: c\n# a comment\n---\n\nBody.'
    )
    expect(meta.slug).toBe('foo')
  })

  it('handles status overrides', () => {
    const { meta } = parseFrontmatter(
      '---\nslug: foo\ntitle: t\ncategory: c\nstatus: DRAFT\n---\n\nBody.'
    )
    expect(meta.status).toBe('DRAFT')
  })
})

describe('seedCorpus', () => {
  it('inserts a new doc when slug not present', async () => {
    mockReaddir.mockResolvedValue(['x.md'])
    mockReadFile.mockResolvedValue(
      '---\nslug: new-slug\ntitle: T\ncategory: c\n---\n\nBody.'
    )
    mockHelpDoc.findUnique.mockResolvedValue(null)
    mockHelpDoc.create.mockResolvedValue({ id: 'doc1', version: 1 })
    mockExecuteRaw.mockResolvedValue(1)

    const r = await seedCorpus('/fake')
    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(0)
    expect(r.errors).toHaveLength(0)
    expect(mockHelpDoc.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        slug:           'new-slug',
        title:          'T',
        category:       'c',
        seededFromFile: 'x.md',
        version:        1,
      }),
    }))
  })

  it('skips when slug already exists', async () => {
    mockReaddir.mockResolvedValue(['x.md'])
    mockReadFile.mockResolvedValue(
      '---\nslug: existing\ntitle: T\ncategory: c\n---\n\nBody.'
    )
    mockHelpDoc.findUnique.mockResolvedValue({ id: 'doc1', slug: 'existing' })

    const r = await seedCorpus('/fake')
    expect(r.inserted).toBe(0)
    expect(r.skipped).toBe(1)
    expect(mockHelpDoc.create).not.toHaveBeenCalled()
  })

  it('records errors for malformed files', async () => {
    mockReaddir.mockResolvedValue(['bad.md'])
    mockReadFile.mockResolvedValue('no frontmatter at all')

    const r = await seedCorpus('/fake')
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].file).toBe('bad.md')
  })

  it('returns 0/0 when corpus dir does not exist', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReaddir.mockRejectedValue(enoent)

    const r = await seedCorpus('/nonexistent')
    expect(r).toEqual({ inserted: 0, skipped: 0, errors: [] })
  })

  it('mixed batch: inserts new + skips existing', async () => {
    mockReaddir.mockResolvedValue(['new.md', 'old.md'])
    mockReadFile
      .mockResolvedValueOnce('---\nslug: new\ntitle: N\ncategory: c\n---\n\nBody.')
      .mockResolvedValueOnce('---\nslug: old\ntitle: O\ncategory: c\n---\n\nBody.')
    mockHelpDoc.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'doc-old' })
    mockHelpDoc.create.mockResolvedValue({ id: 'doc-new', version: 1 })
    mockExecuteRaw.mockResolvedValue(1)

    const r = await seedCorpus('/fake')
    expect(r.inserted).toBe(1)
    expect(r.skipped).toBe(1)
  })
})
