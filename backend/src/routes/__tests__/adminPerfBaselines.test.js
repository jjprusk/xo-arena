// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * GET /api/v1/admin/perf/baselines{,/:filename} — read-only viewer for the
 * JSON artifacts produced by perf/* scripts.
 *
 * Auth-gated by requireAuth + requireAdmin (mocked here to admit). The
 * `node:fs/promises` module is mocked so the tests don't need a real
 * baselines directory on disk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../../middleware/auth.js', () => ({
  requireAuth:  (req, _res, next) => { req.auth = { userId: 'ba_admin_1' }; next() },
  requireAdmin: (_req, _res, next) => next(),
}))

vi.mock('node:fs/promises', () => {
  return {
    default: {
      readdir:  vi.fn(),
      stat:     vi.fn(),
      readFile: vi.fn(),
    },
    readdir:  vi.fn(),
    stat:     vi.fn(),
    readFile: vi.fn(),
  }
})

const fs = (await import('node:fs/promises')).default
const adminPerfBaselinesRouter = (await import('../adminPerfBaselines.js')).default

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/v1/admin/perf', adminPerfBaselinesRouter)
  return app
}

const ORIG_ENV = process.env.PERF_BASELINES_DIR

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env.PERF_BASELINES_DIR
  else process.env.PERF_BASELINES_DIR = ORIG_ENV
})

function dirent(name, isFile = true) {
  return { name, isFile: () => isFile, isDirectory: () => !isFile }
}

describe('GET /api/v1/admin/perf/baselines', () => {
  it('reports enabled:false when PERF_BASELINES_DIR is unset', async () => {
    delete process.env.PERF_BASELINES_DIR
    const res = await request(makeApp()).get('/api/v1/admin/perf/baselines')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: false, dir: null, files: [] })
    expect(fs.readdir).not.toHaveBeenCalled()
  })

  it('reports enabled:false when the directory does not exist', async () => {
    process.env.PERF_BASELINES_DIR = '/missing'
    fs.readdir.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const res = await request(makeApp()).get('/api/v1/admin/perf/baselines')
    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(false)
    expect(res.body.error).toBe('directory not found')
  })

  it('lists files, parses kind/env/timestamp from filenames, sorts by mtime desc', async () => {
    process.env.PERF_BASELINES_DIR = '/perf'
    fs.readdir.mockResolvedValueOnce([
      dirent('bundle-composition-local-2026-05-04T13-42-54-981Z.json'),
      dirent('sse-rtt-staging-2026-05-04T14-00-00-000Z.json'),
      dirent('not-a-perf-file.txt'),                       // wrong ext
      dirent('subdir', false),                             // not a file
      dirent('weirdname.json'),                            // no env segment
      dirent('../escape.json'),                            // path traversal candidate
    ])
    fs.stat
      .mockResolvedValueOnce({ size: 12_000, mtime: new Date('2026-05-04T13:42:55Z') })
      .mockResolvedValueOnce({ size:  4_500, mtime: new Date('2026-05-04T14:00:01Z') })
      .mockResolvedValueOnce({ size:    100, mtime: new Date('2026-05-04T12:00:00Z') })

    const res = await request(makeApp()).get('/api/v1/admin/perf/baselines')

    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect(res.body.dir).toBe('/perf')
    // Excludes .txt, the directory entry, and the traversal candidate (rejected
    // by FILENAME_RE — it contains `/`).
    expect(res.body.files).toHaveLength(3)
    // Sorted desc by mtime — staging file (newer) comes first.
    expect(res.body.files[0]).toMatchObject({
      filename: 'sse-rtt-staging-2026-05-04T14-00-00-000Z.json',
      kind:     'sse-rtt',
      env:      'staging',
      sizeBytes: 4_500,
    })
    expect(res.body.files[1]).toMatchObject({
      filename: 'bundle-composition-local-2026-05-04T13-42-54-981Z.json',
      kind:     'bundle-composition',
      env:      'local',
    })
    // weirdname.json — kind survives, env/timestamp null (no env segment).
    expect(res.body.files[2]).toMatchObject({
      filename:  'weirdname.json',
      kind:      'weirdname',
      env:       null,
      timestamp: null,
    })
  })
})

describe('GET /api/v1/admin/perf/baselines/:filename', () => {
  it('returns 404 when storage is not configured', async () => {
    delete process.env.PERF_BASELINES_DIR
    const res = await request(makeApp()).get('/api/v1/admin/perf/baselines/foo.json')
    expect(res.status).toBe(404)
  })

  it('returns 400 for a filename with path-traversal characters', async () => {
    process.env.PERF_BASELINES_DIR = '/perf'
    const res = await request(makeApp())
      .get('/api/v1/admin/perf/baselines/' + encodeURIComponent('../etc/passwd'))
    expect(res.status).toBe(400)
    expect(fs.readFile).not.toHaveBeenCalled()
  })

  it('returns 404 when the file does not exist', async () => {
    process.env.PERF_BASELINES_DIR = '/perf'
    fs.readFile.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }))
    const res = await request(makeApp()).get('/api/v1/admin/perf/baselines/missing.json')
    expect(res.status).toBe(404)
  })

  it('returns 422 when the file is not valid JSON', async () => {
    process.env.PERF_BASELINES_DIR = '/perf'
    fs.readFile.mockResolvedValueOnce('not json {{{')
    const res = await request(makeApp()).get('/api/v1/admin/perf/baselines/oops.json')
    expect(res.status).toBe(422)
  })

  it('returns parsed JSON content for a valid baseline', async () => {
    process.env.PERF_BASELINES_DIR = '/perf'
    fs.readFile.mockResolvedValueOnce(JSON.stringify({ env: 'local', metric: 'lcp', p95: 1812 }))
    const res = await request(makeApp()).get('/api/v1/admin/perf/baselines/sample.json')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      filename: 'sample.json',
      content:  { env: 'local', metric: 'lcp', p95: 1812 },
    })
  })
})
