import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    setupFiles: ['./tests/disposable-database.ts'],
    include: ['packages/*/src/**/*.integration.test.ts'],
    fileParallelism: false,
  },
});
