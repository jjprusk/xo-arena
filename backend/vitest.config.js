import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
      },
    },
  },
})
