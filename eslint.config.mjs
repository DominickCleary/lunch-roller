import next from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.next/**',
      '**/dist/**',
      '**/next-env.d.ts',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  ...next,
  ...tseslint.configs.recommended,
  { settings: { next: { rootDir: 'apps/web/' } } },
);
