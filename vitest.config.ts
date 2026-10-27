import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/worker/src/**/*.test.ts',
      'apps/web/lib/**/*.test.ts',
    ],
    exclude: ['**/*.integration.test.ts', '**/node_modules/**'],
  },
})
