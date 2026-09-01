/**
 * Migration runner. Applies every .sql file in ../migrations in filename order,
 * once, each inside its own transaction. Safe to run on every boot.
 */
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      )
    `);

    const { rows } = await client.query<{ filename: string }>(
      'select filename from schema_migrations',
    );
    const done = new Set(rows.map((row) => row.filename));

    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      if (done.has(filename)) continue;

      const sql = readFileSync(join(migrationsDir, filename), 'utf8');
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (filename) values ($1)', [filename]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${filename} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }

      applied.push(filename);
      console.log(`applied ${filename}`);
    }
  } finally {
    client.release();
  }

  return applied;
}

// Run directly: `npm run migrate`. Importing this module does nothing.
const isEntrypoint =
  !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  migrate()
    .then((applied) => {
      console.log(applied.length ? `${applied.length} migration(s) applied.` : 'Already up to date.');
      return pool.end();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
