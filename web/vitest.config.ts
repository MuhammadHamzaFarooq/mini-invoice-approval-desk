import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts on purpose.
 *
 * Vitest resolves its own nested copy of Vite, so a shared config file makes
 * the two Plugin types collide at the type level. Splitting them avoids the
 * conflict without casting it away. Tests need no React plugin: esbuild
 * transforms TSX directly using "jsx": "react-jsx" from tsconfig.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
