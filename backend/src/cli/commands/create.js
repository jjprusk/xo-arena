// Copyright © 2026 Joe Pruskowski. All rights reserved.
import { hashPassword } from 'better-auth/crypto'
import { randomBytes } from 'crypto'
import db from '../lib/db.js'
import { ok, fail } from '../lib/safety.js'

function genId() {
  return randomBytes(16).toString('hex')
}

/**
 * Create a single user. Throws on duplicate username/email.
 * @param {{ username, email, displayName, password, verified, roles: string[] }} params
 */
export async function createUser({ username, email, displayName, password, verified, roles = [] }) {
  const existing = await db.user.findFirst({ where: { OR: [{ username }, { email }] } })
  if (existing) throw new Error(`user already exists with username "${username}" or email "${email}"`)

  const baUserId    = genId()
  const baAccountId = genId()
  const hashed      = await hashPassword(password)

  await db.$transaction(async (tx) => {
    await tx.baUser.create({
      data: { id: baUserId, name: displayName, email, emailVerified: verified },
    })
    await tx.baAccount.create({
      data: { id: baAccountId, accountId: email, providerId: 'credential', userId: baUserId, password: hashed },
    })
    const appUser = await tx.user.create({
      data: { username, email, displayName, betterAuthId: baUserId, oauthProvider: 'email', nameConfirmed: true },
    })
    for (const role of roles) {
      await tx.userRole.create({ data: { userId: appUser.id, role, grantedById: appUser.id } })
    }
  })
}

export function createCommand(program) {
  program
    .command('create <username>')
    .description('Create a new user account (verified by default)')
    .option('--password <pwd>', 'Password (defaults to username)')
    .option('--email <addr>', 'Email (defaults to username@dev.local)')
    .option('--display-name <name>', 'Display name (defaults to username)')
    .option('--noverify', 'Leave email unverified')
    .option('--admin', 'Grant ADMIN role')
    .option('--support', 'Grant SUPPORT role')
    .option('--clone <n>', 'Also create n clones named <username>0, <username>1, … each with password = their username')
    .action(async (username, opts) => {
      const email       = opts.email       ?? `${username}@dev.local`
      const displayName = opts.displayName ?? username
      const plainPwd    = opts.password    ?? username
      const verified    = !opts.noverify
      const roles       = [
        ...(opts.admin   ? ['ADMIN']   : []),
        ...(opts.support ? ['SUPPORT'] : []),
      ]

      try {
        await createUser({ username, email, displayName, password: plainPwd, verified, roles })
      } catch (err) {
        fail(err.message)
      }

      const flags = [verified ? 'verified' : 'unverified', ...roles].join(', ')
      ok(`Created user "${username}" (${flags})`)
      console.log(`  email:    ${email}`)
      console.log(`  password: ${plainPwd}`)

      // Create clones if requested
      const cloneCount = opts.clone ? parseInt(opts.clone, 10) : 0
      if (isNaN(cloneCount) || cloneCount < 1) return

      let created = 0
      for (let i = 0; i < cloneCount; i++) {
        const cname = `${username}${i}`
        try {
          await createUser({
            username:    cname,
            email:       `${cname}@dev.local`,
            displayName: cname,
            password:    cname,
            verified,
            roles,
          })
          ok(`  clone "${cname}" (password: ${cname})`)
          created++
        } catch (err) {
          console.error(`  ✗ clone "${cname}" skipped — ${err.message}`)
        }
      }
      console.log(`${created} clone(s) created.`)
    })
}
