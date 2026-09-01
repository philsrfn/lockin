import { type Queryable, pool, queryOne } from '../db';
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

const SELECT = 'select id, name, equipment, food_profile, is_active from contexts';

export async function listContexts(db: Queryable = pool): Promise<Context[]> {
  const { rows } = await db.query<ContextRow>(`${SELECT} order by id`);
  return rows.map(toContext);
}

export async function activeContext(db: Queryable = pool): Promise<Context | null> {
  const { rows } = await db.query<ContextRow>(`${SELECT} where is_active limit 1`);
  const row = rows[0];
  return row ? toContext(row) : null;
}

/**
 * Switching city. One statement, so there is never a moment with two active
 * contexts or none.
 */
export async function activateContext(id: number): Promise<Context[]> {
  const exists = await queryOne<{ id: number }>('select id from contexts where id = $1', [id]);
  if (!exists) throw notFound(`No context ${id}`);

  await pool.query('update contexts set is_active = (id = $1)', [id]);
  return listContexts();
}
