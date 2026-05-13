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
}
