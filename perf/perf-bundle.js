#!/usr/bin/env node
// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * XO Arena — Bundle Composition Snapshot
 *
 * Companion to doc/Performance_Plan_v2.md, Phase 1 + Section F5
 * (per-chunk byte budgets). Builds the landing app and dumps a JSON
 * snapshot of every emitted asset with raw, gzip, and brotli sizes,
 * so a future run after Phase 1 chunk surgery can be diffed against
 * this baseline to verify the savings landed.
 *
 * No extra dependencies — uses Node's built-in `zlib` to compute
 * gzip + brotli compressed sizes (level 9 / quality 11, matching what
 * a CDN would actually serve).
 *
 * Usage:
 *   node perf/perf-bundle.js                # full build, snapshot
 *   node perf/perf-bundle.js --no-build     # snapshot existing dist/
 *
 * Output:
 *   perf/baselines/bundle-composition-local-<isoTimestamp>.json
 */

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname, basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { gzipSync, brotliCompressSync, constants as zlibConstants } from 'zlib'

const args     = process.argv.slice(2)
const NO_BUILD = args.includes('--no-build')

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = dirname(__dirname)
const LANDING   = join(REPO_ROOT, 'landing')
const DIST      = join(LANDING,   'dist')

const BOLD  = s => `\x1b[1m${s}\x1b[0m`
const DIM   = s => `\x1b[2m${s}\x1b[0m`
const GREEN = s => `\x1b[32m${s}\x1b[0m`
const RED   = s => `\x1b[31m${s}\x1b[0m`

function fmtKB(n) {
  return (n / 1024).toFixed(1) + ' KB'
}

function classify(name) {
  const ext = extname(name).toLowerCase()
  if (ext === '.js' || ext === '.mjs') return 'js'
  if (ext === '.css')                  return 'css'
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif'].includes(ext)) return 'img'
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font'
  return 'other'
}

/** Strip the Vite content hash from chunk names (`Foo-AbCdEf12.js` → `Foo.js`). */
function stripHash(name) {
  return name.replace(/-[A-Za-z0-9_-]{8,16}(\.[a-z0-9]+)$/, '$1')
}

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st   = statSync(full)
    if (st.isDirectory()) walk(full, base, out)
    else                  out.push(full)
  }
  return out
}

function build() {
  console.log(BOLD('Building landing...'))
  console.log(DIM(`  cwd=${LANDING}`))
  try {
    execSync('npm run build', { cwd: LANDING, stdio: 'inherit' })
  } catch (err) {
    console.log(RED(`Build failed (exit ${err.status ?? '?'})`))
    process.exit(err.status ?? 1)
  }
  console.log()
}

function snapshot() {
  if (!existsSync(DIST)) {
    console.log(RED(`No dist/ directory at ${DIST} — run without --no-build first.`))
    process.exit(1)
  }

  const files = walk(DIST)
  const assets = []
  for (const full of files) {
    const buf  = readFileSync(full)
    const raw  = buf.length
    let gzip   = null
    let brotli = null
    // Don't waste cycles compressing already-compressed assets.
    const ext = extname(full).toLowerCase()
    const skipCompress = ['.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2', '.gz', '.br', '.avif', '.gif'].includes(ext)
    if (!skipCompress) {
      gzip   = gzipSync(buf, { level: 9 }).length
      brotli = brotliCompressSync(buf, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
      }).length
    }
    const rel = full.slice(DIST.length + 1)
    assets.push({
      name:        rel,
      stem:        stripHash(basename(rel)),
      type:        classify(rel),
      raw,
      gzip,
      brotli,
    })
  }

  // Aggregations.
  const totals = { raw: 0, gzip: 0, brotli: 0 }
  const perType = {}
  for (const a of assets) {
    totals.raw    += a.raw
    totals.gzip   += a.gzip   ?? a.raw
    totals.brotli += a.brotli ?? a.raw
    if (!perType[a.type]) perType[a.type] = { raw: 0, gzip: 0, brotli: 0, count: 0 }
    perType[a.type].raw    += a.raw
    perType[a.type].gzip   += a.gzip   ?? a.raw
    perType[a.type].brotli += a.brotli ?? a.raw
    perType[a.type].count  += 1
  }

  // Print summary.
  console.log(BOLD('Bundle composition'))
  console.log(`  total      raw ${fmtKB(totals.raw).padEnd(12)} gzip ${fmtKB(totals.gzip).padEnd(12)} brotli ${fmtKB(totals.brotli)}`)
  for (const [type, t] of Object.entries(perType).sort((a, b) => b[1].raw - a[1].raw)) {
    console.log(`  ${type.padEnd(10)} raw ${fmtKB(t.raw).padEnd(12)} gzip ${fmtKB(t.gzip).padEnd(12)} brotli ${fmtKB(t.brotli).padEnd(12)} ${DIM(`(${t.count} files)`)}`)
  }
  console.log()
  console.log(BOLD('Top 10 JS chunks (raw)'))
  const jsAssets = assets.filter(a => a.type === 'js').sort((a, b) => b.raw - a.raw).slice(0, 10)
  for (const a of jsAssets) {
    console.log(`  ${a.stem.padEnd(40)} raw ${fmtKB(a.raw).padEnd(12)} gzip ${fmtKB(a.gzip).padEnd(12)} brotli ${fmtKB(a.brotli)}`)
  }
  console.log()

  return { assets, totals, perType }
}

function main() {
  if (!NO_BUILD) build()
  const startedAt = new Date()
  const isoStamp  = startedAt.toISOString().replace(/[:.]/g, '-')
  const { assets, totals, perType } = snapshot()

  const outDir = join(__dirname, 'baselines')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `bundle-composition-local-${isoStamp}.json`)
  writeFileSync(outPath, JSON.stringify({
    timestamp: startedAt.toISOString(),
    env:       'local',
    totals,
    perType,
    assets:    assets.sort((a, b) => b.raw - a.raw),
  }, null, 2))
  console.log(`  Saved → ${outPath.replace(REPO_ROOT + '/', '')}\n`)
}

main()
