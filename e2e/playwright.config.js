import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // PvP + PvAI tests share server-side state (a single community bot user,
  // a single socket.io namespace). `fullyParallel: false` only serialises
  // within a file; distinct files still race across workers and caused
  // flaky failures when pvai.spec.js and replay.spec.js (both use
  // startPvAIGame → the community bot) ran simultaneously. `workers: 1`
  // makes the whole suite sequential. Slower clock time but deterministic —
  // the suite is short (~3 min) so the trade is worth it.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Default baseURL = landing (the unified platform). LANDING_URL is the
    // canonical env var; BASE_URL is honored for back-compat but legacy.
    baseURL: process.env.LANDING_URL || process.env.BASE_URL || 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ['**/stress.spec.js'],  // excluded from default run
    },
    {
      name: 'stress',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['**/stress.spec.js'],
    },
  ],
})
