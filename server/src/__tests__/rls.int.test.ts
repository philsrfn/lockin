/**
 * The backstop under every `where user_id`.
 *
 * The static guard next door reads SQL literals and fails the build when a
 * query against an owned table does not name `user_id`. It is a blunt
 * instrument on purpose and it says so: it can tell a present predicate from
 * an absent one, and nothing more. `where id = $1 and user_id = $2` with the
 * arguments the wrong way round passes it, compiles, runs, and returns
 * somebody else's body weight shaped exactly like the right answer.
 *
 * This is the test docs/tenancy.md asks for as the fourth and last step: proof
 * that the database itself refuses, rather than a promise that the queries are
 * careful. Everything here goes around the services deliberately — the point
 * is what happens when the application layer is wrong.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type Ctx, crossTenant, ctxFor, pool } from '../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../test/helpers';
import { logWeight } from '../services/bodyweight';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
  await logWeight(phil, { weightKg: 95, measuredOn: '2026-09-01' });
});

describe('a query with the wrong tenant in it', () => {
  it('returns nothing rather than the other athlete\'s rows', async () => {
    // The mistake the guard cannot catch, written out: the predicate is
    // present, names user_id, and holds the wrong id.
    const { rows } = await sam.db.query('select weight_kg from bodyweight where user_id = $1', [
      phil.userId,
    ]);

    expect(rows).toEqual([]);
  });

  it('still returns the athlete\'s own rows, so the policy is not simply off', async () => {
    const { rows } = await phil.db.query('select weight_kg from bodyweight where user_id = $1', [
      phil.userId,
    ]);

    expect(rows).toHaveLength(1);
  });

  it('refuses to write a row belonging to somebody else', async () => {
    // `with check`, the half of the policy that stops a wrong id going in.
    await expect(
      sam.db.query('insert into bodyweight (user_id, measured_on, weight_kg) values ($1, $2, $3)', [
        phil.userId,
        '2026-09-02',
        70,
      ]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('a connection with no tenant at all', () => {
  /**
   * The frontier, asserted rather than described.
   *
   * A query that never goes through a `Ctx` runs as the connection's own role,
   * and that role is the cluster's bootstrap superuser — exempt from row level
   * security no matter what the policies say, and unable to give up superuser
   * because Postgres refuses to let the bootstrap role do that. So the
   * protection covers every path through a `Ctx`, which is every service, and
   * does not cover a raw pool query.
   *
   * Closing that means the app connecting as `lockin_app` rather than as the
   * owner: a credential change, not a schema one. docs/tenancy.md carries the
   * step. When somebody takes it, this test fails — which is the point of
   * writing it this way round rather than leaving a comment.
   */
  it('still sees everything, which is the step that is left', async () => {
    const { rows } = await pool.query('select weight_kg from bodyweight');

    expect(
      rows,
      'if this is empty, the app now connects as a non-superuser — tighten this test and update docs/tenancy.md',
    ).not.toEqual([]);
  });

  it('covers every table that holds somebody data, not a list kept by hand', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select c.table_name
       from information_schema.columns c
       where c.table_schema = 'public' and c.column_name = 'user_id'
         and not exists (
           select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.table_name
         )`,
    );

    expect(rows.map((row) => row.table_name)).toEqual([]);
  });

  it('forces the policy on the owner, which is who the app connects as', async () => {
    // Without FORCE the owner is exempt and every policy above is decoration.
    const { rows } = await pool.query<{ relname: string }>(
      `select c.relname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relrowsecurity and not c.relforcerowsecurity`,
    );

    expect(rows.map((row) => row.relname)).toEqual([]);
  });
});

describe('the one way past it', () => {
  it('lets the admin panel read across everybody', async () => {
    const rows = await crossTenant(async (db) => {
      const result = await db.query('select user_id from bodyweight');
      return result.rows;
    });

    expect(rows.length).toBeGreaterThan(0);
  });

  it('does not leak out of the transaction that asked for it', async () => {
    // Transaction-local, so a pooled connection never carries the exemption —
    // or the tenant, or the role — into whatever borrows it next. Checked
    // through a scoped context, because a bare pool query is exempt anyway.
    await crossTenant(async (db) => db.query('select 1'));

    const { rows } = await sam.db.query('select weight_kg from bodyweight where user_id = $1', [
      phil.userId,
    ]);

    expect(rows).toEqual([]);
  });
});

describe('the shared catalogue', () => {
  it('is readable by everybody, because it belongs to nobody', async () => {
    // `programs.user_id` is null for the built-ins, and reading has always
    // included them. A policy that missed this would empty the app of
    // programmes for every athlete at once.
    const { rows } = await ctxFor(sam.userId).db.query(
      'select slug from programs where user_id is null',
    );

    expect(rows.length).toBeGreaterThan(0);
  });
});
