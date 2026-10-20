import { defineConfig } from '@playwright/test';
import './tests/disposable-database';
export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: process.env.APP_ORIGIN ?? 'http://localhost:3000' },
  webServer: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL!,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? 'integration-only-password',
      SESSION_SECRET:
        process.env.SESSION_SECRET ??
        'integration-only-session-secret-at-least-32-characters',
      APP_ORIGIN: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    },
    command: `pnpm --filter @lunch/web start --port ${new URL(process.env.APP_ORIGIN ?? 'http://localhost:3000').port || '3000'}`,
    url: process.env.APP_ORIGIN ?? 'http://localhost:3000',
    reuseExistingServer: false,
  },
});
