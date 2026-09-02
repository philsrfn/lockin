/**
 * Scratch databases for the integration tests.
 *
 * The services layer is the only write path in the app (§11), so testing it
 * against a mock would test the mock. These tests run against a real Postgres:
 * `global-setup` builds one template database with every migration applied,
 * and each test file gets its own copy of it. Copying a template is a file
 * copy inside Postgres — cheaper than replaying nine migrations per file, and
 * it means one test can never see another's rows.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const TEMPLATE_DB = 'lockin_test_template';

/** Scratch databases all share this prefix so stale ones can be swept up. */
export const SCRATCH_PREFIX = 'lockin_test_';

/**
 * The repo's .env holds the local Postgres credentials. Reading it here means
 * `npm test` works with no further setup — vitest is not launched through tsx,
 * so it does not get --env-file.
 */
function databaseUrlFromDotEnv(): string | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env');
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line);
      if (match?.[1]) return match[1].replace(/^["']|["']$/g, '');
    }
  } catch {
    // No .env — fall through to the default below.
  }
  return null;
}

/**
 * Where to build the scratch databases. The tests never touch the database in
 * this URL; they borrow its host and credentials to create their own beside it.
 */
function baseUrl(): URL {
  const raw =
    process.env.TEST_DATABASE_URL ??
    databaseUrlFromDotEnv() ??
    'postgres://lockin:lockin@localhost:5433/lockin';
  const url = new URL(raw);

  // The suite drops and recreates databases. Doing that on the production host
  // would not destroy real data, but it has no business being there at all.
  if (!['localhost', '127.0.0.1', 'db', '::1'].includes(url.hostname)) {
    throw new Error(
      `Refusing to run integration tests against ${url.hostname}. ` +
        'Set TEST_DATABASE_URL to a local Postgres.',
    );
  }
  return url;
}

export function urlForDatabase(name: string): string {
  const url = baseUrl();
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * A connection to the server's own `postgres` database. `create database` and
 * `drop database` cannot run from inside the database they are acting on.
 */
export function adminPool(): pg.Pool {
  return new pg.Pool({ connectionString: urlForDatabase('postgres'), max: 1 });
}

export async function dropDatabase(admin: pg.Pool, name: string): Promise<void> {
  // `force` terminates leftover backends. Without it a single connection that
  // outlived its test wedges the whole suite on the next run.
  await admin.query(`drop database if exists "${name}" with (force)`);
}

/**
 * `env.ts` fails loudly at import when a secret is missing, which is the right
 * behaviour in production and useless in a test. Fill in placeholders — no
 * integration test talks to Gemini, and the bearer token only matters to the
 * route tests, which use this value.
 */
export const TEST_BEARER_TOKEN = 'test-token';

export function applyTestEnv(databaseUrl: string): void {
  process.env.DATABASE_URL = databaseUrl;
  process.env.APP_BEARER_TOKEN ??= TEST_BEARER_TOKEN;
  process.env.GEMINI_API_KEY ??= 'test-key-not-used';
  process.env.LOG_LEVEL ??= 'silent';
}
