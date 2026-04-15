import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // PvP tests share socket state — run serially
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
