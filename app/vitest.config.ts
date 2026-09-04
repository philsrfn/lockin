import { defineConfig } from 'vitest/config';

/**
 * The app had no tests, which is why everything that computes a number lives
 * on the server. Bar loading cannot: it has to answer live while the stepper
 * moves, and in a basement gym with no signal.
 *
 * So this covers pure modules under `src/lib/` only — no React, no React
 * Native, no renderer. Anything that needs a component tree wants a different
 * setup and a reason to justify it.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/__tests__/**/*.test.ts'],
  },
});
