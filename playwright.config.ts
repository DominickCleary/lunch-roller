import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.APP_ORIGIN ?? 'http://localhost:3000' },
  webServer: {
    command: `pnpm --filter @lunch/web start --port ${new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').port || '3000'}`,
    url: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    reuseExistingServer: false,
  },
});
