#!/usr/bin/env node
/**
 * XO Arena QA — interactive test runner
 *
 * Usage:  node e2e/qa.mjs   OR   npm run qa (from project root)
 *
 * Env vars (set before launching):
 *   BACKEND_URL, TOURNAMENT_URL   service base URLs  (default: localhost)
 *   ADMIN_EMAIL, ADMIN_PASSWORD   required for tournament tests
 *   TEST_USER_EMAIL, TEST_USER_PASSWORD   optional for Playwright auth tests
 *   TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD  optional for Playwright admin tests
 *   STRESS_ADMIN_TOKEN            optional for stress test health endpoint
 */

import { spawn }         from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname }       from 'node:path'

const E2E = dirname(fileURLToPath(import.meta.url))

// ── ANSI ──────────────────────────────────────────────────────────────────────

const A = {
  reset:       '\x1b[0m',
  bold:        '\x1b[1m',
  dim:         '\x1b[2m',
  green:       '\x1b[32m',
  red:         '\x1b[31m',
  yellow:      '\x1b[33m',
  cyan:        '\x1b[36m',
  gray:        '\x1b[90m',
  hideCursor:  '\x1b[?25l',
  showCursor:  '\x1b[?25h',
  clear:       '\x1b[2J\x1b[H',
}

const out = s => process.stdout.write(s)

// ── Runners ───────────────────────────────────────────────────────────────────

function exec(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: opts.cwd ?? E2E,
      env: { ...process.env, ...opts.env },
    })
    child.on('exit', code => resolve({ ok: code === 0, code: code ?? 1 }))
    child.on('error', err => { console.error(err.message); resolve({ ok: false, code: 1 }) })
  })
}

const pw     = (suite, extra = []) => exec('npx', ['playwright', 'test', ...(suite ? [suite] : []), '--project=chromium', ...extra])
const stress = ()                   => exec('npx', ['playwright', 'test', 'stress', '--project=stress', '--timeout=400000'])
const large  = (extra = [])         => exec('node', ['qa-tournament-large.mjs', ...extra])

// ── Menu definition ───────────────────────────────────────────────────────────
// S = section header, I = selectable item, D = blank divider

const S = label         => ({ kind: 's', label })
const I = (label, fn, hint) => ({ kind: 'i', label, fn, hint })
const D = ()            => ({ kind: 'd' })

const MENU = [
  S('Tournament'),
  I('Large-scale: 20 bots × HvH + Mixed + BvB',       () => large()),
  I('Large-scale: cleanup previous run, then run',     () => large(['--cleanup'])),
  I('Quick: 8 bots per tournament',                    () => large(['--count', '8'])),
  D(),
  S('Playwright'),
  I('Smoke tests',                                     () => pw('smoke'),    'BACKEND_URL + LANDING_URL'),
  I('Phase 3.5 feature checks',                        () => pw('phase35'),  'TEST_USER_EMAIL, TEST_ADMIN_EMAIL (optional)'),
  I('PvAI game tests',                                 () => pw('pvai')),
  I('PvP game tests',                                  () => pw('pvp')),
  I('Replay tests',                                    () => pw('replay')),
  I('Tournament seed bots (QA §9)',                    () => pw('tournament-seed-bots'),       'TEST_ADMIN_EMAIL'),
  I('Template clone flow (Phase 3.7a)',                () => pw('tournament-template-clone'),  'TEST_ADMIN_EMAIL'),
  I('Template create endpoint (Phase 3.7a s2)',        () => pw('tournament-template-create'), 'TEST_ADMIN_EMAIL'),
  I('All Playwright (chromium)',                        () => pw(null)),
  D(),
  S('Long-running'),
  I('Stress tests  (~5 min)',                          () => stress(), 'STRESS_ADMIN_TOKEN'),
  D(),
  I('Quit',                                            () => { out(A.showCursor); process.exit(0) }),
]

const items = MENU.flatMap((m, i) => m.kind === 'i' ? [{ m, i }] : [])

// ── Render ────────────────────────────────────────────────────────────────────

function render(selIdx, lastRun) {
  const BACKEND    = process.env.BACKEND_URL    || 'http://localhost:3000'
  const TOURNAMENT = process.env.TOURNAMENT_URL || 'http://localhost:3001'
  const email      = process.env.ADMIN_EMAIL    || null
  const hasPass    = !!process.env.ADMIN_PASSWORD

  const lines = ['']
  lines.push(`${A.bold}${A.cyan}  XO Arena QA${A.reset}`)
  lines.push('')
  lines.push(`  ${A.gray}Backend   ${A.reset} ${BACKEND}`)
  lines.push(`  ${A.gray}Tournament${A.reset} ${TOURNAMENT}`)
  if (email) {
    const passNote = hasPass ? '' : `  ${A.yellow}(ADMIN_PASSWORD not set)${A.reset}`
    lines.push(`  ${A.gray}Admin     ${A.reset} ${email}${passNote}`)
  } else {
    lines.push(`  ${A.gray}Admin     ${A.reset} ${A.yellow}ADMIN_EMAIL not set — tournament tests will fail${A.reset}`)
  }
  lines.push('')

  for (const entry of MENU) {
    if (entry.kind === 's') {
      const bar = '─'.repeat(Math.max(2, 38 - entry.label.length))
      lines.push(`  ${A.dim}── ${entry.label}  ${bar}${A.reset}`)
    } else if (entry.kind === 'd') {
      lines.push('')
    } else {
      const active = items[selIdx]?.m === entry
      const cursor = active ? `${A.cyan}${A.bold} >${A.reset}` : '  '
      const label  = active ? `${A.bold}${entry.label}${A.reset}` : entry.label
      const hint   = entry.hint ? `  ${A.dim}${entry.hint}${A.reset}` : ''
      lines.push(`  ${cursor} ${label}${hint}`)
    }
  }

  lines.push('')
  if (lastRun) {
    const icon = lastRun.ok ? `${A.green}✓${A.reset}` : `${A.red}✗${A.reset}`
    lines.push(`  ${icon} Last: ${lastRun.label}`)
  }
  lines.push(`  ${A.dim}↑ ↓ navigate    Enter run    q quit${A.reset}`)
  lines.push('')

  out(A.clear + A.hideCursor + lines.join('\n'))
}

// ── Key reader ────────────────────────────────────────────────────────────────

function readKey() {
  return new Promise(resolve => {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', key => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      resolve(key)
    })
  })
}

async function waitForAnyKey() {
  out(`\n  ${A.dim}Press any key to return to the menu...${A.reset}\n`)
  await readKey()
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!process.stdout.isTTY) {
  console.error('qa must be run in an interactive terminal (TTY)')
  process.exit(1)
}

process.on('SIGINT', () => { out(A.showCursor + '\n'); process.exit(0) })
process.on('exit',   () => out(A.showCursor))

let selIdx  = 0
let lastRun = null

render(selIdx, lastRun)

while (true) {
  const key = await readKey()

  if (key === '\x1b[A' || key === '\x1bOA') {       // up
    selIdx = (selIdx - 1 + items.length) % items.length
    render(selIdx, lastRun)

  } else if (key === '\x1b[B' || key === '\x1bOB') { // down
    selIdx = (selIdx + 1) % items.length
    render(selIdx, lastRun)

  } else if (key === '\r' || key === '\n') {          // enter
    const { m } = items[selIdx]
    out(A.showCursor + A.clear)
    out(`${A.bold}Running: ${m.label}${A.reset}\n\n`)
    const result = await m.fn()
    if (result !== undefined) {                       // Quit returns undefined
      lastRun = { label: m.label, ok: result.ok }
      await waitForAnyKey()
      render(selIdx, lastRun)
    }

  } else if (key === 'q' || key === 'Q' || key === '\x1b' || key === '\x03') {
    out(A.showCursor + '\n')
    process.exit(0)
  }
}
