// Copyright © 2026 Joe Pruskowski. All rights reserved.
/**
 * Sprint 5 — `um rewards` (Intelligent_Guide_Requirements.md §10.6).
 *
 *   um rewards show <user>          # list which discovery rewards are granted
 *   um rewards grant <user> <key>   # mark a discovery reward as granted (and
 *                                     pay the SystemConfig'd TC, if not paid)
 *   um rewards revoke <user> <key>  # remove from the granted list (does NOT
 *                                     refund TC — a reversal would be confusing)
 *   um rewards reset <user>         # clear the granted list entirely (next
 *                                     trigger event will re-pay)
 *
 * Valid keys come from DISCOVERY_REWARD_KEYS — currently:
 *   firstSpecializeAction
 *   firstRealTournamentWin
 *   firstNonDefaultAlgorithm
 *   firstTemplateClone
 */
import db from '../lib/db.js'
import { resolveUsers, ok, fail } from '../lib/safety.js'
import {
  DISCOVERY_REWARDS,
  DISCOVERY_REWARD_KEYS,
  grantDiscoveryReward,
} from '../../services/discoveryRewardsService.js'

const TEAL  = '\x1b[36m'
const DIM   = '\x1b[2m'
const BOLD  = '\x1b[1m'
const RESET = '\x1b[0m'

function _grantedFor(user) {
  const list = user?.preferences?.discoveryRewardsGranted
  return Array.isArray(list) ? list : []
}

async function _setGranted(user, nextList) {
  const prefs = (user.preferences && typeof user.preferences === 'object') ? user.preferences : {}
  await db.user.update({
    where: { id: user.id },
    data:  { preferences: { ...prefs, discoveryRewardsGranted: nextList } },
  })
}

export function rewardsCommand(program) {
  const cmd = program
    .command('rewards <action> <usernameOrEmail> [rewardKey]')
    .description(
      'Inspect / grant / revoke / reset discovery rewards for a user.\n' +
      `  Valid actions:    show | grant | revoke | reset\n` +
      `  Valid reward keys: ${DISCOVERY_REWARD_KEYS.join(', ')}\n`
    )
    .action(async (action, usernameOrEmail, rewardKey) => {
      if (!['show', 'grant', 'revoke', 'reset'].includes(action)) {
        fail(`unknown action "${action}". Use show | grant | revoke | reset`)
      }
      if ((action === 'grant' || action === 'revoke') && !rewardKey) {
        fail(`${action} requires a rewardKey. Valid: ${DISCOVERY_REWARD_KEYS.join(', ')}`)
      }
      if (rewardKey && !DISCOVERY_REWARD_KEYS.includes(rewardKey)) {
        fail(`unknown rewardKey "${rewardKey}". Valid: ${DISCOVERY_REWARD_KEYS.join(', ')}`)
      }

      const users = await resolveUsers(db, usernameOrEmail)
      if (users.length === 0) fail(`no users found matching "${usernameOrEmail}"`)

      for (const user of users) {
        const granted = _grantedFor(user)

        if (action === 'show') {
          console.log(`${BOLD}"${user.username}"${RESET}  TC: ${user.creditsTc ?? 0}`)
          for (const key of DISCOVERY_REWARD_KEYS) {
            const has = granted.includes(key)
            const mark = has ? `${TEAL}●${RESET}` : `${DIM}○${RESET}`
            const tc   = DISCOVERY_REWARDS[key].defaultTc
            console.log(`  ${mark} ${key.padEnd(28)} (+${tc} TC default)`)
          }
          continue
        }

        if (action === 'grant') {
          if (granted.includes(rewardKey)) {
            console.log(`  ${DIM}— "${user.username}" already has ${rewardKey}, skipped${RESET}`)
            continue
          }
          // Use the service's grant — pays TC + emits the socket event in the
          // unlikely case there's a connected admin observer. io is undefined
          // here (CLI), so emission is a no-op; the TC payout still happens.
          const ok_ = await grantDiscoveryReward(user.id, rewardKey)
          if (ok_) ok(`Granted ${rewardKey} to "${user.username}"`)
          else     fail(`grant ${rewardKey} for "${user.username}" failed`)
          continue
        }

        if (action === 'revoke') {
          if (!granted.includes(rewardKey)) {
            console.log(`  ${DIM}— "${user.username}" does not have ${rewardKey}, skipped${RESET}`)
            continue
          }
          await _setGranted(user, granted.filter(k => k !== rewardKey))
          ok(`Revoked ${rewardKey} from "${user.username}" (TC not refunded)`)
          continue
        }

        if (action === 'reset') {
          await _setGranted(user, [])
          ok(`Cleared all discovery grants for "${user.username}"`)
        }
      }
    })

  return cmd
}
