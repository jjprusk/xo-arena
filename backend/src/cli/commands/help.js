// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * `um help-*` commands for the Learnable Help System.
 *
 *  um help-list                  → table of every doc in the DB
 *  um help-reindex [slug]        → rebuild chunks + embeddings (all or one)
 *  um help-export [--out <dir>]  → write every published doc back to .md files
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import db from '../lib/db.js'
import { ok, fail } from '../lib/safety.js'
import { reindexDoc, reindexAll } from '../../services/help/corpusSeeder.js'
// NOTE: help-ask intentionally does NOT import helpService directly. Per
// the refactor on 2026-05-13, the CLI calls the same HTTP endpoint
// (/api/v1/help/ask) the application uses, so the CLI exercises the
// exact same code path — auth middleware, rate limiter (when added),
// retry logic, content filter, persistence. See helpAskHttp below.

const RESET = '\x1b[0m'
const BOLD  = '\x1b[1m'
const DIM   = '\x1b[2m'

export function helpCommand(program) {
  program
    .command('help-list')
    .description('List all Help System docs (slug, title, status, version, chunks).')
    .action(async () => {
      const docs = await db.helpDoc.findMany({
        orderBy: [{ category: 'asc' }, { slug: 'asc' }],
      })
      if (docs.length === 0) {
        console.log(`${DIM}(no help docs in DB)${RESET}`)
        return
      }
      const ids = docs.map(d => d.id)
      const chunkRows = await db.helpChunk.groupBy({
        by: ['docId'],
        where: { docId: { in: ids } },
        _count: { _all: true },
      })
      const chunkCounts = Object.fromEntries(chunkRows.map(r => [r.docId, r._count._all]))

      console.log(`${BOLD}slug                       category    status     v   chunks  title${RESET}`)
      for (const d of docs) {
        const slug    = d.slug.padEnd(26)
        const cat     = (d.category || '').padEnd(12)
        const status  = d.status.padEnd(10)
        const ver     = String(d.version).padEnd(3)
        const chunks  = String(chunkCounts[d.id] ?? 0).padEnd(7)
        console.log(`${slug} ${cat}${status} ${ver} ${chunks}${d.title}`)
      }
    })

  program
    .command('help-reindex [slug]')
    .description('Rebuild chunks + embeddings. With no slug, reindexes every doc.')
    .action(async (slug) => {
      if (slug) {
        const doc = await db.helpDoc.findUnique({ where: { slug } })
        if (!doc) fail(`no doc with slug "${slug}"`)
        const r = await reindexDoc(doc.id)
        ok(`reindexed ${slug} → ${r.chunkCount} chunks`)
      } else {
        const results = await reindexAll()
        for (const r of results) {
          const doc = await db.helpDoc.findUnique({ where: { id: r.docId }, select: { slug: true } })
          console.log(`  ${doc?.slug ?? r.docId} → ${r.chunkCount} chunks`)
        }
        ok(`reindexed ${results.length} doc(s)`)
      }
    })

  program
    .command('help-export')
    .description('Write all published HelpDoc rows to markdown files (round-trip backup). Default output is /tmp/help-export inside the container — copy out to /doc/Help_Corpus on the host afterwards.')
    .option('--out <dir>', 'Output directory', '/tmp/help-export')
    .option('--all', 'Include DRAFT and ARCHIVED docs in the export', false)
    .action(async (opts) => {
      const where = opts.all ? {} : { status: 'PUBLISHED' }
      const docs = await db.helpDoc.findMany({ where, orderBy: { slug: 'asc' } })
      if (docs.length === 0) {
        console.log(`${DIM}(nothing to export)${RESET}`)
        return
      }

      await mkdir(opts.out, { recursive: true })

      let written = 0
      for (const d of docs) {
        const fm = [
          '---',
          `slug: ${d.slug}`,
          `title: ${d.title}`,
          `category: ${d.category}`,
          `tags: [${(d.tags ?? []).join(', ')}]`,
          `status: ${d.status}`,
          'admin_only: false',
          '---',
          '',
        ].join('\n')
        const file = join(opts.out, `${d.slug}.md`)
        await writeFile(file, fm + d.body + (d.body.endsWith('\n') ? '' : '\n'), 'utf8')
        written++
      }
      ok(`wrote ${written} doc(s) to ${opts.out}`)
    })

  program
    .command('help-ask <question...>')
    .description('Run a help question through the real /api/v1/help/ask endpoint (same path the Help UI uses). Streams the SSE response and prints the result. Uses the X-Internal-Secret bypass auth so no session is required.')
    // Default `http://localhost:3000` works from both contexts:
    //   - host: docker-compose exposes 3000 → reaches the running backend
    //   - inside the backend container: the same process loopback address
    // Set BACKEND_URL to override (e.g., point at staging).
    .option('--backend <url>', 'Backend base URL', process.env.BACKEND_URL ?? 'http://localhost:3000')
    .option('--secret <s>',    'X-Internal-Secret header value', process.env.INTERNAL_SECRET ?? 'xo-arena-internal-dev-secret')
    .option('--route <path>',  'Context: route the user is "on"',     '/cli')
    .option('--slot <name>',   'Context: panel slot',                 'um:help-ask')
    .option('--game <id>',     'Context: gameType (xo or pong)',      'xo')
    .option('--no-stream',     'Skip live token output; only print the final accumulated answer')
    .option('--json',          'Emit structured frames as JSON lines instead of plain text')
    .action(async (questionWords, opts) => {
      const question = questionWords.join(' ').trim()
      if (!question) fail('help-ask: question must not be empty')

      const url = `${opts.backend.replace(/\/$/, '')}/api/v1/help/ask`
      const t0  = Date.now()
      let tokenCount = 0
      let doneFrame  = null
      let errorFrame = null

      let res
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type':      'application/json',
            'X-Internal-Secret': opts.secret,
            'Accept':            'text/event-stream',
          },
          body: JSON.stringify({
            question,
            context: {
              route:       opts.route,
              currentSlot: opts.slot,
              gameType:    opts.game,
            },
          }),
        })
      } catch (err) {
        fail(`help-ask: cannot reach ${url} — ${err?.cause?.code ?? err.message}`)
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        fail(`help-ask: HTTP ${res.status} — ${body.slice(0, 200)}`)
      }

      // Parse SSE incrementally. Frames are `event: <name>\ndata: <json>\n\n`.
      const decoder = new TextDecoder()
      let pending = ''
      try {
        for await (const chunk of res.body) {
          pending += decoder.decode(chunk, { stream: true })
          let idx
          while ((idx = pending.indexOf('\n\n')) !== -1) {
            const block = pending.slice(0, idx); pending = pending.slice(idx + 2)
            const evLine = block.split('\n').find(l => l.startsWith('event: '))
            const dlLine = block.split('\n').find(l => l.startsWith('data: '))
            if (!evLine || !dlLine) continue
            const event = evLine.slice(7)
            const data  = JSON.parse(dlLine.slice(6))
            const frame = { kind: event, ...data }

            if (opts.json) { console.log(JSON.stringify(frame)); continue }

            if (event === 'token') {
              tokenCount++
              if (opts.stream !== false) process.stdout.write(data.text)
            } else if (event === 'done') {
              doneFrame = frame
            } else if (event === 'error') {
              errorFrame = frame
            }
          }
        }
      } catch (err) {
        fail(`help-ask: SSE read failed — ${err.message}`)
      }

      if (opts.json) return

      if (tokenCount > 0 && opts.stream !== false) process.stdout.write('\n')

      if (errorFrame) fail(`help-ask: error frame: ${JSON.stringify(errorFrame)}`)
      if (!doneFrame) fail('help-ask: stream ended without a terminal frame')

      console.log()
      console.log(`${DIM}── result ─────────────────────────────────────────────${RESET}`)
      console.log(`  endpoint              ${url}`)
      console.log(`  queryId               ${doneFrame.queryId}`)
      console.log(`  answerId              ${doneFrame.answerId ?? '(persist failed)'}`)
      console.log(`  tokens streamed       ${tokenCount}`)
      console.log(`  contentFilterTriggered ${doneFrame.contentFilterTriggered}`)
      console.log(`  degraded (embed)      ${doneFrame.degraded}`)
      console.log(`  latency (server)      ${doneFrame.latencyMs}ms`)
      console.log(`  wall clock            ${Date.now() - t0}ms`)
      if (opts.stream === false) {
        console.log()
        console.log(`${BOLD}── answer ─────────────────────────────────────────────${RESET}`)
        console.log(doneFrame.rendered)
      }
      ok('help-ask complete')
    })
}
