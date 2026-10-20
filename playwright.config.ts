import { defineConfig } from '@playwright/test';
import './tests/disposable-database';
export default defineConfig({
  testDir: './tests/e2e',
  projects: [
    { name: 'first-run', testMatch: '**/setup.spec.ts' },
    {
      name: 'fixtures',
      testMatch: '**/fixture-setup.ts',
      dependencies: ['first-run'],
    },
    {
      name: 'chromium',
      testIgnore: [
        '**/rate-limit.spec.ts',
        '**/setup.spec.ts',
        '**/fixture-setup.ts',
      ],
      dependencies: ['fixtures'],
    },
    {
      name: 'login-throttle',
      testMatch: '**/rate-limit.spec.ts',
      dependencies: ['chromium'],
    },
  ],
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
