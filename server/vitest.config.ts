import { defineConfig } from 'vitest/config';

/** Shared defaults. The two suites are defined in vitest.workspace.ts. */
export default defineConfig({
  test: { environment: 'node' },
});
