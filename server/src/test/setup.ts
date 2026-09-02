/**
 * Runs before each integration test file's imports. Cuts a scratch database
 * from the template and points DATABASE_URL at it, so `db.ts` — which reads the
 * URL once at import — connects to this file's own copy.
 *
 * Every service defaults its `db` argument to the module-level pool, and the
 * sync queue opens its own transactions through it. Redirecting the pool is
 * therefore the only way to exercise those paths as they actually run.
 */
import { randomBytes } from 'node:crypto';
import { afterAll } from 'vitest';
import { SCRATCH_PREFIX, TEMPLATE_DB, adminPool, applyTestEnv, urlForDatabase } from './database';

const name = `${SCRATCH_PREFIX}${randomBytes(6).toString('hex')}`;

const admin = adminPool();
await admin.query(`create database "${name}" template "${TEMPLATE_DB}"`);
await admin.end();

applyTestEnv(urlForDatabase(name));

afterAll(async () => {
  const { pool } = await import('../db');
  // Deliberately no `drop database` here. Dropping it out from under a pool
  // that is still closing its sockets races, and the losing side surfaces as
  // an unhandled "terminating connection due to administrator command".
  // global-setup sweeps every lockin_test_* database at the start of the next
  // run instead — which also leaves a failed run's data there to look at.
  await pool.end();
});
