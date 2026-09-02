import { defineWorkspace } from 'vitest/config';

/**
 * Two suites, split by what they need to run.
 *
 * `unit` is the domain and rules layers: pure functions, no I/O, fast enough to
 * run on every save. `integration` needs a Postgres — it exercises the services
 * against a real schema, because a mocked database would only ever prove the
 * mock agrees with itself.
 */
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['src/**/__tests__/**/*.test.ts'],
      exclude: ['src/**/__tests__/**/*.int.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'integration',
      include: ['src/**/__tests__/**/*.int.test.ts'],
      environment: 'node',
      globalSetup: ['./src/test/global-setup.ts'],
      setupFiles: ['./src/test/setup.ts'],
      // Each file cuts its own database from the template; serialising keeps
      // those CREATE DATABASE calls from queueing behind each other.
      fileParallelism: false,
      // A scratch database plus nine migrations is slower to reach the first
      // assertion than a pure function is.
      testTimeout: 20_000,
      hookTimeout: 30_000,
    },
  },
]);
