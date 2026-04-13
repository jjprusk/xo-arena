// Copyright © 2026 Joe Pruskowski. All rights reserved.
import db from '../lib/db.js'
import { ok, fail } from '../lib/safety.js'

async function getConfig(key, defaultValue) {
  const row = await db.systemConfig.findUnique({ where: { key } })
  return row ? row.value : defaultValue
}

async function setConfig(key, value) {
  await db.systemConfig.upsert({
    where:  { key },
    update: { value },
    create: { key, value },
  })
}

export function sessionConfigCommand(program) {
  program
    .command('session-config')
    .description('Show or set idle timeout config (idleWarnMinutes, idleGraceMinutes). No flags = show current values.')
    .option('--warn <minutes>', 'Minutes of inactivity before the "Still there?" warning appears')
    .option('--grace <minutes>', 'Minutes after the warning before auto sign-out')
    .action(async (opts) => {
      const hasChanges = opts.warn !== undefined || opts.grace !== undefined

      if (hasChanges) {
        if (opts.warn !== undefined) {
          const v = parseInt(opts.warn, 10)
          if (isNaN(v) || v < 1) fail('--warn must be >= 1')
          await setConfig('session.idleWarnMinutes', v)
        }
        if (opts.grace !== undefined) {
          const v = parseInt(opts.grace, 10)
          if (isNaN(v) || v < 1) fail('--grace must be >= 1')
          await setConfig('session.idleGraceMinutes', v)
        }
      }

      const [warn, grace] = await Promise.all([
        getConfig('session.idleWarnMinutes',  30),
        getConfig('session.idleGraceMinutes',  5),
      ])

      if (hasChanges) ok('session config updated')
      console.log(`  idleWarnMinutes:  ${warn}   (warn after this many minutes of inactivity)`)
      console.log(`  idleGraceMinutes: ${grace}   (auto sign-out this many minutes after warning)`)
    })
}
