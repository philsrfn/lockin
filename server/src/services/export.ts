/**
 * Everything this app holds about one person, in one file.
 *
 * Article 15 and Article 20 of the GDPR: the right to know what is held, and
 * the right to take it somewhere else in a machine-readable form. Both are
 * satisfied by the same thing as long as it is actually complete, which is the
 * only hard part.
 *
 * So the tables are read out of the schema rather than listed here. A list
 * kept by hand is a list that goes stale the first time somebody adds a table
 * without reading this file — which has already happened once, to the static
 * tenancy guard, and cost it seven tables. Anything carrying a `user_id` is
 * somebody's data by definition, and that is exactly the definition migration
 * 028 uses to decide what to protect.
 */
import type { Ctx } from '../db';

export type Export = {
  exportedAt: string;
  /** Table name to rows, every row belonging to the athlete who asked. */
  data: Record<string, unknown[]>;
};

async function ownedTables(ctx: Ctx): Promise<string[]> {
  const { rows } = await ctx.db.query<{ table_name: string }>(
    `select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'user_id'
     order by table_name`,
  );
  return rows.map((row) => row.table_name);
}

export async function exportEverything(ctx: Ctx): Promise<Export> {
  const data: Record<string, unknown[]> = {};

  for (const table of await ownedTables(ctx)) {
    /*
     * The table name is interpolated because a table name cannot be a bind
     * parameter in Postgres. It comes from information_schema rather than from
     * anything a caller sent, so there is nothing here for a caller to shape —
     * and the tenant still arrives as a parameter, and row level security is
     * underneath either way.
     */
    const { rows } = await ctx.db.query(
      `select * from "${table}" where user_id = $1`,
      [ctx.userId],
    );
    if (rows.length > 0) data[table] = rows;
  }

  // The account row itself, which has an `id` rather than a `user_id` and so
  // is not caught by the sweep above. Without it an export says what somebody
  // did and never says who they are.
  const { rows: account } = await ctx.db.query(
    `select id, name, email, is_admin, approved_at, created_at
     from users where id = $1`,
    [ctx.userId],
  );
  data.users = account;

  return { exportedAt: new Date().toISOString(), data };
}
