import { hashPassword } from 'better-auth/crypto'
import { randomBytes } from 'crypto'
import db from '../lib/db.js'
import { ok, fail } from '../lib/safety.js'

function genId() {
  return randomBytes(16).toString('hex')
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
    .action(async (username, opts) => {
      const email       = opts.email       ?? `${username}@dev.local`
      const displayName = opts.displayName ?? username
      const plainPwd    = opts.password    ?? username
      const verified    = !opts.noverify

      // Check for duplicates
      const existing = await db.user.findFirst({
        where: { OR: [{ username }, { email }] },
      })
      if (existing) fail(`user already exists with username "${username}" or email "${email}"`)

      const baUserId    = genId()
      const baAccountId = genId()
      const hashed      = await hashPassword(plainPwd)

      await db.$transaction(async (tx) => {
        await tx.baUser.create({
          data: {
            id:            baUserId,
            name:          displayName,
            email,
            emailVerified: verified,
          },
        })

        await tx.baAccount.create({
          data: {
            id:         baAccountId,
            accountId:  email,
            providerId: 'credential',
            userId:     baUserId,
            password:   hashed,
          },
        })

        const appUser = await tx.user.create({
          data: {
            username,
            email,
            displayName,
            betterAuthId:  baUserId,
            oauthProvider: 'email',
            nameConfirmed: true,
          },
        })

        const roles = [
          ...(opts.admin   ? ['ADMIN']   : []),
          ...(opts.support ? ['SUPPORT'] : []),
        ]
        for (const role of roles) {
          await tx.userRole.create({ data: { userId: appUser.id, role, grantedById: appUser.id } })
        }
      })

      const flags = [
        verified ? 'verified' : 'unverified',
        ...(opts.admin   ? ['ADMIN']   : []),
        ...(opts.support ? ['SUPPORT'] : []),
      ].join(', ')

      ok(`Created user "${username}" (${flags})`)
      console.log(`  email:    ${email}`)
      console.log(`  password: ${plainPwd}`)
    })
}
