import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/e2e/stripe-webhook.integration.test.ts'], maxWorkers: 1 },
  resolve: { alias: { '@': new URL('../../apps/web/src', import.meta.url).pathname } },
});
