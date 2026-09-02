import type { Ctx } from '../db';
import { notFound } from '../errors';

export type Context = {
  id: number;
  name: string;
  equipment: Record<string, unknown>;
  foodProfile: Record<string, unknown>;
  isActive: boolean;
};

type ContextRow = {
  id: number;
  name: string;
  equipment: Record<string, unknown>;
  food_profile: Record<string, unknown>;
  is_active: boolean;
};

const toContext = (row: ContextRow): Context => ({
  id: row.id,
  name: row.name,
  equipment: row.equipment,
  foodProfile: row.food_profile,
  isActive: row.is_active,
});

// Carries the tenant predicate, like the session and food selects: callers
// append `and ...`, and a fragment that could be used unscoped does not exist.
const SELECT = `
  select id, name, equipment, food_profile, is_active from contexts
  where user_id = $1
`;

export async function listContexts(ctx: Ctx): Promise<Context[]> {
  const { rows } = await ctx.db.query<ContextRow>(`${SELECT} order by id`, [ctx.userId]);
  return rows.map(toContext);
}

export async function activeContext(ctx: Ctx): Promise<Context | null> {
  const { rows } = await ctx.db.query<ContextRow>(`${SELECT} and is_active limit 1`, [ctx.userId]);
  const row = rows[0];
  return row ? toContext(row) : null;
}

/**
 * Switching city. One statement, so there is never a moment with two active
 * contexts or none.
 */
export async function activateContext(ctx: Ctx, id: number): Promise<Context[]> {
  // Scoped on the way in: a context id belonging to someone else must read as
  // missing, not as a thing he is merely forbidden to switch to.
  const { rowCount } = await ctx.db.query('select 1 from contexts where id = $1 and user_id = $2', [
    id,
    ctx.userId,
  ]);
  if (!rowCount) throw notFound(`No context ${id}`);

  await ctx.db.query('update contexts set is_active = (id = $1) where user_id = $2', [
    id,
    ctx.userId,
  ]);
  return listContexts(ctx);
}
