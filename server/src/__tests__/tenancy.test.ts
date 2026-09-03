/**
 * A guard on the thing that fails silently.
 *
 * A forgotten `where user_id` does not throw. It returns somebody else's rows,
 * shaped exactly like the right answer, and nothing downstream can tell. The
 * usual backstop for that is row-level security, which is not in place here yet
 * (see docs/tenancy.md) — so until it is, this reads every SQL statement in the
 * source and refuses any that touches an owned table without naming user_id.
 *
 * It is a blunt instrument. It cannot tell a correct predicate from a wrong
 * one, only a present one from an absent one. That is still the difference
 * between the mistake being caught at authoring time and being caught by
 * somebody seeing another person's body weight.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tables with a user_id. Kept in step with migration 011 by the test below, so
 * a new owned table cannot quietly escape this check.
 */
const OWNED_TABLES = [
  'profile',
  'contexts',
  'sessions',
  'sets',
  'bodyweight',
  'meals',
  'fridge_inventory',
  'rules',
  'chat_messages',
  'sync_log',
  'foods',
  'coach_notes',
  'job_schedule',
  'job_runs',
  'push_tokens',
  'weekly_reviews',
];

/**
 * Files whose whole job is to cross tenants or to run before any exist.
 * Anything not on this list is held to the rule.
 */
const EXEMPT = new Set([
  // Resolves a token to a user, and provisions new ones — there is no current
  // tenant yet at either point.
  'services/users.ts',
  'create-user.ts',
  // DDL, and a local-only fixture that refuses to run against real data.
  'migrate.ts',
  'seed-demo.ts',
  // The admin panel. Reading across every athlete is its entire job, and it
  // counts in server time on purpose: the bill arrives in one timezone, not in
  // each athlete's. The compensating check is at the bottom of this file —
  // every route that reaches it must be behind requireAdmin.
  'services/admin.ts',
]);

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'test') continue;
      found.push(...sourceFiles(path));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/** Template and quoted literals that read like SQL. */
function sqlLiterals(source: string): string[] {
  const literals = source.match(/`[^`]*`|'[^'\n]*'/g) ?? [];
  return literals
    .map((literal) => literal.slice(1, -1))
    .filter((text) => /\b(select|insert\s+into|update|delete\s+from)\b/i.test(text));
}

/** Owned tables a statement reads or writes. */
function tablesTouched(sql: string): string[] {
  const names = new Set<string>();
  const references = sql.matchAll(/\b(from|join|into|update)\s+([a-z_]+)/gi);
  for (const match of references) {
    const table = match[2]!.toLowerCase();
    if (OWNED_TABLES.includes(table)) names.add(table);
  }
  return [...names];
}

describe('every query names its tenant', () => {
  const files = sourceFiles(root)
    .map((path) => relative(root, path))
    .filter((path) => !EXEMPT.has(path));

  const offenders: { file: string; table: string; sql: string }[] = [];

  for (const file of files) {
    for (const sql of sqlLiterals(readFileSync(join(root, file), 'utf8'))) {
      if (sql.includes('user_id')) continue;
      for (const table of tablesTouched(sql)) {
        offenders.push({ file, table, sql: sql.replace(/\s+/g, ' ').trim().slice(0, 120) });
      }
    }
  }

  it('finds no statement touching an owned table without user_id', () => {
    expect(
      offenders.map((entry) => `${entry.file}: ${entry.table} — ${entry.sql}`),
    ).toEqual([]);
  });

  it('actually examined the source, rather than finding nothing to examine', () => {
    // A refactor that moves the services elsewhere must break this loudly
    // rather than quietly passing an empty check.
    const withSql = files.filter(
      (file) => sqlLiterals(readFileSync(join(root, file), 'utf8')).length > 0,
    );
    expect(withSql.length).toBeGreaterThan(12);
  });
});

describe('no query decides the date for itself', () => {
  // The timezone work replaced every `current_date` with an explicit range
  // computed in the athlete's zone. This is the check that stops one coming
  // back — which it did, in the first query written after that work landed.
  const SERVER_CLOCK = /\bcurrent_date\b|\bcurrent_timestamp\b|\blocaltimestamp\b/i;

  it('uses no server-clock date function', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(root).map((path) => relative(root, path))) {
      if (EXEMPT.has(file)) continue;
      for (const sql of sqlLiterals(readFileSync(join(root, file), 'utf8'))) {
        if (SERVER_CLOCK.test(sql)) {
          offenders.push(`${file}: ${sql.replace(/\s+/g, ' ').trim().slice(0, 100)}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the owned-table list', () => {
  it('matches the migration that added the columns', () => {
    const migration = readFileSync(join(root, '..', 'migrations', '011_users.sql'), 'utf8');
    const block = /foreach t in array array\[([\s\S]*?)\]/.exec(migration)?.[1] ?? '';
    const inMigration = [...block.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!);

    expect(new Set(inMigration)).toEqual(new Set(OWNED_TABLES));
  });
});


describe('the admin panel is the exception, and stays behind its guard', () => {
  // services/admin.ts is exempt from the tenant rule above because crossing
  // tenants is what it is for. That exemption is only safe while nothing can
  // reach it without being an admin, so that is checked rather than trusted.
  const routes = readFileSync(join(root, 'routes', 'admin.ts'), 'utf8');

  it('guards every route it declares', () => {
    const declared = [...routes.matchAll(/app\.(get|post|patch|delete)\(\s*'([^']+)'/g)];
    const handlers = routes.split(/app\.(?:get|post|patch|delete)\(/).slice(1);

    expect(declared.length).toBeGreaterThan(3);

    const unguarded = declared
      .map((match, index) => ({ path: match[2]!, body: handlers[index] ?? '' }))
      // The page itself is a shell with no data in it; it is public so that a
      // browser can load it before it has a token to send.
      .filter(({ path, body }) => path !== '/admin' && !body.includes('requireAdmin'))
      .map(({ path }) => path);

    expect(unguarded).toEqual([]);
  });

  it('is the only file importing the admin service', () => {
    const importers = sourceFiles(root)
      .map((path) => relative(root, path))
      .filter((file) => /from '[^']*services\/admin'/.test(readFileSync(join(root, file), 'utf8')));

    expect(importers).toEqual(['routes/admin.ts']);
  });
});
