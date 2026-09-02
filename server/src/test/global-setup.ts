/**
 * Runs once for the whole integration run: builds the template database the
 * per-file scratch copies are cut from.
 */
import {
  SCRATCH_PREFIX,
  TEMPLATE_DB,
  adminPool,
  applyTestEnv,
  dropDatabase,
  urlForDatabase,
} from './database';

export default async function setup(): Promise<void> {
  const admin = adminPool();

  try {
    // A crashed run leaves its scratch database behind. Sweep before building,
    // not after: a failed run is exactly when you want the database to still
    // exist for inspection.
    const { rows } = await admin.query<{ datname: string }>(
      `select datname from pg_database
       where datname like $1 and datname <> $2`,
      [`${SCRATCH_PREFIX}%`, TEMPLATE_DB],
    );
    for (const row of rows) {
      await dropDatabase(admin, row.datname);
    }

    await dropDatabase(admin, TEMPLATE_DB);
    await admin.query(`create database "${TEMPLATE_DB}"`);
  } finally {
    await admin.end();
  }

  // Imported here, not at the top: `db.ts` reads DATABASE_URL at import time,
  // and the template is not where the tests will be writing.
  applyTestEnv(urlForDatabase(TEMPLATE_DB));
  const pg = (await import('pg')).default;
  const templatePool = new pg.Pool({ connectionString: urlForDatabase(TEMPLATE_DB) });
  try {
    const { migrate } = await import('../migrate');
    await migrate(templatePool);
  } finally {
    await templatePool.end();
  }
}
