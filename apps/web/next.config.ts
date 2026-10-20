import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
const config: NextConfig = {
  transpilePackages: ['@lunch/contracts', '@lunch/db', '@lunch/domain'],
  poweredByHeader: false,
};
export default config;
