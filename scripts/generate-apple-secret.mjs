/**
 * Generates an Apple client secret JWT for Sign In with Apple.
 * Run once, then set the output as APPLE_CLIENT_SECRET in Railway.
 * The secret is valid for 6 months — regenerate before it expires.
 *
 * Usage:
 *   APPLE_TEAM_ID=3468UM8RT5 \
 *   APPLE_KEY_ID=YGBL2H98WT \
 *   APPLE_CLIENT_ID=com.callidity.xo.signin \
 *   APPLE_PRIVATE_KEY_PATH=/Users/joe/Desktop/AuthKey_YGBL2H98WT.p8 \
 *   node scripts/generate-apple-secret.mjs
 */

import { readFileSync } from 'fs'
import { createSign } from 'crypto'

const TEAM_ID       = process.env.APPLE_TEAM_ID
const KEY_ID        = process.env.APPLE_KEY_ID
const CLIENT_ID     = process.env.APPLE_CLIENT_ID
const KEY_PATH      = process.env.APPLE_PRIVATE_KEY_PATH

if (!TEAM_ID || !KEY_ID || !CLIENT_ID || !KEY_PATH) {
  console.error('Missing required env vars: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID, APPLE_PRIVATE_KEY_PATH')
  process.exit(1)
}

const privateKey = readFileSync(KEY_PATH, 'utf8')

const now = Math.floor(Date.now() / 1000)
const exp = now + 15777000 // ~6 months

const header  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KEY_ID })).toString('base64url')
const payload = Buffer.from(JSON.stringify({
  iss: TEAM_ID,
  iat: now,
  exp,
  aud: 'https://appleid.apple.com',
  sub: CLIENT_ID,
})).toString('base64url')

const signingInput = `${header}.${payload}`
const sign = createSign('SHA256')
sign.update(signingInput)
const signature = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')

const jwt = `${signingInput}.${signature}`

console.log('\nAPPLE_CLIENT_SECRET=')
console.log(jwt)
console.log(`\nExpires: ${new Date(exp * 1000).toISOString()}`)
