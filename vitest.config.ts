import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests only. The renderer modules under test are pure TypeScript, so no DOM
 * environment and no React plugin are needed here; `electron.vite.config.ts` still
 * owns the application build. The aliases must match the renderer's.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared'),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
