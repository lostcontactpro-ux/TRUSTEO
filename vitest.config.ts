import { defineConfig } from 'vitest/config';
export default defineConfig({test:{include:['packages/**/*.test.ts','apps/**/*.test.ts'],exclude:['**/node_modules/**'], maxWorkers:2},resolve:{alias:{'@':new URL('./apps/web/src',import.meta.url).pathname}}});
