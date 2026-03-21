/**
 * Better Auth central instance.
 * Mounted at /api/auth/* in app.js.
 */

import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { jwt } from 'better-auth/plugins'
import { admin } from 'better-auth/plugins'
import db from './db.js'
import logger from '../logger.js'
import { syncUser } from '../services/userService.js'

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),
  // Email + password is built-in — no plugin import needed
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [
    jwt(),
    admin({ adminRole: 'admin' }),
  ],
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      },
    }),
    ...(process.env.APPLE_CLIENT_ID && {
      apple: {
        clientId: process.env.APPLE_CLIENT_ID,
        clientSecret: process.env.APPLE_CLIENT_SECRET,
      },
    }),
  },
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production',
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],
  databaseHooks: {
    user: {
      create: {
        after: async (baUser) => {
          try {
            await syncUser({
              betterAuthId: baUser.id,
              email: baUser.email,
              username: baUser.name?.toLowerCase().replace(/\s+/g, '_') || baUser.email.split('@')[0],
              displayName: baUser.name || baUser.email.split('@')[0],
              oauthProvider: 'email',
              avatarUrl: baUser.image || null,
            })
          } catch (err) {
            logger.warn({ err: err.message, userId: baUser.id }, 'Post-createUser domain upsert failed')
          }
        },
      },
    },
  },
})
