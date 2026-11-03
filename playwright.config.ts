import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env')) loadEnvFile('.env');
if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3100';
export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.spec.ts',
  fullyParallel: false, workers: 1, retries: 0,
  timeout: 60_000, expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium-mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } }],
  webServer: {
    command: `npm run dev -w @trusteo/web -- --port ${new URL(baseURL).port || '3100'}`,
    url: `${baseURL}/login`, reuseExistingServer: process.env.E2E_REUSE_SERVER === '1', timeout: 120_000,
    env: {
      APP_URL: baseURL, DATABASE_URL: process.env.DATABASE_URL || '',
      // Local browser checks never send email, purchase subscriptions, or call AI.
      STRIPE_SECRET_KEY: '', OPENAI_API_KEY: '', TRUSTEO_OPENAI_API_KEY: '', RESEND_API_KEY: '',
    },
  },
});
