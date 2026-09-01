/**
 * Phil's own food library. §11: no general nutrition database — roughly 90% of
 * intake is ~25 foods, and the library grows by use rather than by seeding.
 */
import { type Queryable, pool } from '../db';
import { badRequest, notFound } from '../errors';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Food = {
  id: number;
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number | null;
  carbsG: number | null;
  quickAdd: boolean;
  defaultSlot: MealSlot | null;
  timesUsed: number;
  lastUsedAt: string | null;
};

type FoodRow = {
  id: number;
  name: string;
  kcal: number;
  protein_g: number;
  fat_g: number | null;
  carbs_g: number | null;
  quick_add: boolean;
  default_slot: string | null;
  times_used: number;
  last_used_at: Date | null;
};

const toFood = (row: FoodRow): Food => ({
  id: row.id,
  name: row.name,
  kcal: row.kcal,
  proteinG: row.protein_g,
  fatG: row.fat_g,
  carbsG: row.carbs_g,
  quickAdd: row.quick_add,
  defaultSlot: (row.default_slot as MealSlot | null) ?? null,
  timesUsed: row.times_used,
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
});

const SELECT = `
  select id, name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot,
         times_used, last_used_at
  from foods
  where not archived
`;

/**
 * Quick-add tiles first, then whatever he has reached for most recently.
 * That ordering is the whole point: the top of the screen should already have
 * what he is about to log.
 */
export async function listFoods(db: Queryable = pool): Promise<Food[]> {
  const { rows } = await db.query<FoodRow>(
    `${SELECT} order by quick_add desc, last_used_at desc nulls last, times_used desc, name`,
  );
  return rows.map(toFood);
}

export async function getFood(id: number, db: Queryable = pool): Promise<Food> {
  const { rows } = await db.query<FoodRow>(`${SELECT} and id = $1`, [id]);
  const row = rows[0];
  if (!row) throw notFound(`No food ${id}`);
  return toFood(row);
}

export type SaveFoodInput = {
  name: string;
  kcal: number;
  proteinG: number;
  fatG?: number | null;
  carbsG?: number | null;
  quickAdd?: boolean;
  defaultSlot?: MealSlot | null;
};

export async function createFood(input: SaveFoodInput, db: Queryable = pool): Promise<Food> {
  const name = input.name?.trim();
  if (!name) throw badRequest('A food needs a name');
  if (!Number.isFinite(input.kcal) || input.kcal < 0) throw badRequest('kcal must be a number');
  if (!Number.isFinite(input.proteinG) || input.proteinG < 0) {
    throw badRequest('proteinG must be a number');
  }

  const { rows } = await db.query<FoodRow>(
    `insert into foods (name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot)
     values ($1, $2, $3, $4, $5, $6, $7)
     -- Saving the same thing twice should update it, not fail. He is not
     -- thinking about primary keys while logging lunch.
     on conflict (lower(name)) where not archived do update
       set kcal = excluded.kcal, protein_g = excluded.protein_g,
           fat_g = excluded.fat_g, carbs_g = excluded.carbs_g,
           quick_add = excluded.quick_add, default_slot = excluded.default_slot
     returning id, name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot,
               times_used, last_used_at`,
    [
      name,
      Math.round(input.kcal),
      Math.round(input.proteinG),
      input.fatG == null ? null : Math.round(input.fatG),
      input.carbsG == null ? null : Math.round(input.carbsG),
      input.quickAdd ?? false,
      input.defaultSlot ?? null,
    ],
  );
  return toFood(rows[0]!);
}

export async function updateFood(
  id: number,
  input: Partial<SaveFoodInput>,
  db: Queryable = pool,
): Promise<Food> {
  const current = await getFood(id, db);
  const { rows } = await db.query<FoodRow>(
    `update foods set name = $2, kcal = $3, protein_g = $4, fat_g = $5, carbs_g = $6,
                      quick_add = $7, default_slot = $8
     where id = $1
     returning id, name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot,
               times_used, last_used_at`,
    [
      id,
      input.name?.trim() || current.name,
      input.kcal ?? current.kcal,
      input.proteinG ?? current.proteinG,
      input.fatG === undefined ? current.fatG : input.fatG,
      input.carbsG === undefined ? current.carbsG : input.carbsG,
      input.quickAdd ?? current.quickAdd,
      input.defaultSlot === undefined ? current.defaultSlot : input.defaultSlot,
    ],
  );
  return toFood(rows[0]!);
}

/**
 * Archived, never deleted. Meals already logged against it keep their food_id,
 * and his history stays intact.
 */
export async function archiveFood(id: number, db: Queryable = pool): Promise<void> {
  const { rowCount } = await db.query('update foods set archived = true where id = $1', [id]);
  if (!rowCount) throw notFound(`No food ${id}`);
}

export async function recordUse(id: number, db: Queryable = pool): Promise<void> {
  await db.query(
    'update foods set times_used = times_used + 1, last_used_at = now() where id = $1',
    [id],
  );
}
