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

export const pool = new pg.Pool({ connectionString: env.databaseUrl });

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

export const ctxFor = (userId: number, db: Queryable = pool): Ctx => ({ userId, db });

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

/** `transaction`, but handing back a Ctx bound to the transaction's client. */
export async function transactionFor<T>(
  ctx: Ctx,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  return transaction((client) => fn(withDb(ctx, client)));
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
