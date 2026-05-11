import { defineConfig } from 'vitest/config';

/**
 * Vitest config for `apps/desktop`. Uses the `node` test environment because
 * the tests target pure store helpers (split-tree ops, fuzzy match, command
 * routing, status getters) — no DOM or React rendering is exercised. If a
 * DOM-dependent test is ever added, switch that single file to a `// @vitest-environment jsdom` annotation rather than flipping the global default.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', 'src-tauri'],
  },
});
