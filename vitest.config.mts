import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Sets dummy API env before any test module imports config/env.ts (which would otherwise
    // process.exit on missing env). Harmless for UI/contract tests; real env still wins.
    setupFiles: ['apps/api/vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.next/**',
    ],
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
})
