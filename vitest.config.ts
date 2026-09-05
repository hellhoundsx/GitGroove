import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Unit tests only; `electron.vite.config.ts` still owns the application build.
 *
 * Two projects, split by file extension (GC-046): `*.test.ts` covers the pure renderer and
 * shared modules and keeps the cheap `node` environment, `*.test.tsx` renders components and
 * gets jsdom plus the React plugin. The extension is the whole switch, so a new test picks its
 * environment by what it is named. The aliases must match the renderer's, in both projects.
 *
 * The node project also reaches into `tools/` (GC-070), where the tests for the launcher and for
 * the repository itself live next to what they cover. `*.test.ts` is deliberate: the scripts in
 * that tree are `.mjs` and none of them is a test, so nothing there is picked up by accident.
 */
const alias = {
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          include: ['src/**/*.test.tsx'],
          environment: 'jsdom',
        },
      },
    ],
  },
});
