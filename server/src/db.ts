import pg from 'pg';
import { env } from './env';

// node-postgres hands back `numeric` and `bigint` as strings to avoid silent
// precision loss. Weights and rep counts are small; strings leaking into the
// domain layer would be a constant source of `"87.5" + 2.5 === "87.52.5"`.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number);
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
// `date` (measured_on) as a plain YYYY-MM-DD string, not a Date shifted by the
// server's timezone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  /**
   * Bounded, and bounded loudly.
   *
   * Every scoped query is a transaction now — see `scopedTo` below — so a
   * connection is held for a begin/commit rather than for a single statement,
   * and a screen that fetches a dozen things in parallel wants a dozen of
   * them at once. Without a timeout, a pool with nothing free waits for ever:
   * the integration suite ran twelve files at once, exhausted the server, and
   * five tests sat for sixteen minutes instead of failing. In production the
   * same shape is an app that hangs rather than an error anybody can see.
   *
   * So: a ceiling per process, and a wait that gives up. A request that cannot
   * get a connection in ten seconds is not going to be worth answering.
   */
  max: Number(process.env.PGPOOL_MAX ?? 10),
  connectionTimeoutMillis: 10_000,
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

/**
 * Whose data, and on which connection.
 *
 * Every service takes one of these. It replaced the old optional `db` argument
 * rather than joining it, so that adding the tenant dimension was a change the
 * compiler could enumerate — there is no call site that reads a table without
 * saying who is asking, because there is no way to write one.
 */
export type Ctx = {
  userId: number;
  db: Queryable;
  /**
   * True when `db` is already a transaction's client. The sync queue runs each
   * op inside one, and the services it calls must join that transaction rather
   * than opening a nested one — otherwise a failed op would commit half of
   * itself.
   */
  inTransaction?: boolean;
};

/**
 * Carrying the tenant into the database, so row level security can act on it.
 *
 * Migration 028 puts a policy on every table with a `user_id`, and those
 * policies read `app.user_id`. Something has to set it, and where that
 * something lives is the whole design decision.
 *
 * docs/tenancy.md proposed a client checked out for the life of the request.
 * That works and it has a failure mode worth avoiding: the client must be
 * released on every exit path — responses, thrown errors, timeouts, aborted
 * sockets — and a chat request holds one for the ten seconds it waits on a
 * model. One missed release is a connection gone from the pool for good, and
 * the symptom arrives much later, as an app that hangs.
 *
 * So the tenant hangs off the transaction instead. Every scoped query runs in
 * one, `set_config` is transaction-local, and the setting cannot outlive the
 * statement it was set for. A pooled connection therefore never carries one
 * request's tenant into the next — which is the hazard that made the
 * session-level version unsafe, and it is structural here rather than
 * something to remember.
 *
 * It costs a begin and a commit per query. Against a socket on the same box
 * that is measured in tens of microseconds, and the calls this app actually
 * waits on are measured in seconds.
 */
/**
 * Step into the role the policies apply to, and say whose data this is.
 *
 * `set local role` rather than a different connection string: the app connects
 * as the cluster's bootstrap superuser, which cannot give up superuser and is
 * therefore exempt from row level security no matter what the policies say.
 * `lockin_app` owns nothing and is nobody's superuser, so inside this
 * transaction the policies are the law. Both settings are local, so the commit
 * puts everything back and a pooled connection never carries either into
 * whatever borrows it next.
 */
async function enterTenant(client: Queryable, userId: number): Promise<void> {
  await client.query('set local role lockin_app');
  await client.query('select set_config($1, $2, true)', ['app.user_id', String(userId)]);
}

function scopedTo(userId: number): Queryable {
  return {
    query: ((text: unknown, params?: unknown[]) =>
      transaction(async (client) => {
        await enterTenant(client, userId);
        return client.query(text as string, params);
      })) as Queryable['query'],
  };
}

/**
 * A context bound to one athlete.
 *
 * `db` defaults to a tenant-scoped queryable rather than the bare pool, so
 * every existing call site and every test gained the backstop without
 * changing a line. Passing an explicit `db` is how work inside a transaction
 * joins it — see `withDb`, which relies on the tenant already being set on
 * that transaction.
 */
export const ctxFor = (userId: number, db?: Queryable): Ctx => ({
  userId,
  db: db ?? scopedTo(userId),
});

/**
 * A connection allowed to cross tenants, for the three places that have no
 * single one by definition.
 *
 * There are four, and a grep for this function is how you find them:
 *
 *   - the migration runner, which is DDL and seeds before anybody exists
 *   - provisioning an athlete, whose rows are written before there is a
 *     tenant for them to belong to
 *   - the admin panel, whose entire job is reading across everybody, and
 *     which is behind `requireAdmin` on every route that reaches it
 *   - registering a push token, because a device that changes hands has to
 *     take its token with it
 *
 * The first three are the same three the static guard in
 * `__tests__/tenancy.test.ts` exempts. The fourth was found by switching row
 * level security on and watching it refuse. Anything else reaching for this
 * is a bug.
 */
export async function crossTenant<T>(fn: (db: Queryable) => Promise<T>): Promise<T> {
  return transaction(async (client) => {
    await client.query("select set_config('app.cross_tenant', 'on', true)");
    return fn(client);
  });
}

/** The same tenant on a different connection — for work inside a transaction. */
export const withDb = (ctx: Ctx, db: Queryable): Ctx => ({
  userId: ctx.userId,
  db,
  inTransaction: true,
});

export async function query<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * `transaction`, but handing back a Ctx bound to the transaction's client.
 *
 * The tenant is set once here rather than per statement: everything inside
 * shares the one transaction, so one `set_config` covers all of it.
 */
export async function transactionFor<T>(
  ctx: Ctx,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  return transaction(async (client) => {
    await enterTenant(client, ctx.userId);
    return fn(withDb(ctx, client));
  });
}

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
