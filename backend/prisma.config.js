import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: '../packages/db/prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL,
  },
  seed: 'node --experimental-transform-types prisma/seed.js',
})
