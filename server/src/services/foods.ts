/**
 * Phil's own food library. §11: no general nutrition database — roughly 90% of
 * intake is ~25 foods, and the library grows by use rather than by seeding.
 */
import type { Ctx } from '../db';
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
  /**
   * null = the numbers above are one portion, log them as they stand.
   * 100 = they describe 100 grams, and a portion has to be given before
   * anything can be logged. See domain/portions.ts and migration 027.
   */
  perGrams: number | null;
  /** What was eaten last time. The opening offer when asking how much. */
  lastGrams: number | null;
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
  per_grams: number | null;
  last_grams: number | null;
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
  perGrams: row.per_grams,
  lastGrams: row.last_grams,
});

const SELECT = `
  select id, name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot,
         times_used, last_used_at, per_grams, last_grams
  from foods
  where not archived and user_id = $1
`;

/**
 * Quick-add tiles first, then whatever he has reached for most recently.
 * That ordering is the whole point: the top of the screen should already have
 * what he is about to log.
 */
export async function listFoods(ctx: Ctx): Promise<Food[]> {
  const { rows } = await ctx.db.query<FoodRow>(
    `${SELECT} order by quick_add desc, last_used_at desc nulls last, times_used desc, name`,
    [ctx.userId],
  );
  return rows.map(toFood);
}

export async function getFood(ctx: Ctx, id: number): Promise<Food> {
  const { rows } = await ctx.db.query<FoodRow>(`${SELECT} and id = $2`, [ctx.userId, id]);
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
  /** 100 when the macros describe 100g; omit when they are one portion. */
  perGrams?: number | null;
};

export async function createFood(ctx: Ctx, input: SaveFoodInput): Promise<Food> {
  const name = input.name?.trim();
  if (!name) throw badRequest('A food needs a name');
  if (!Number.isFinite(input.kcal) || input.kcal < 0) throw badRequest('kcal must be a number');
  if (!Number.isFinite(input.proteinG) || input.proteinG < 0) {
    throw badRequest('proteinG must be a number');
  }

  const { rows } = await ctx.db.query<FoodRow>(
    `insert into foods (user_id, name, kcal, protein_g, fat_g, carbs_g, quick_add,
                        default_slot, per_grams)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     -- Saving the same thing twice should update it, not fail. He is not
     -- thinking about primary keys while logging lunch.
     on conflict (user_id, lower(name)) where not archived do update
       set kcal = excluded.kcal, protein_g = excluded.protein_g,
           fat_g = excluded.fat_g, carbs_g = excluded.carbs_g,
           quick_add = excluded.quick_add, default_slot = excluded.default_slot,
           -- Re-saving a scanned product must not turn it back into a portion.
           per_grams = excluded.per_grams
     returning id, name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot,
               times_used, last_used_at, per_grams, last_grams`,
    [
      ctx.userId,
      name,
      Math.round(input.kcal),
      Math.round(input.proteinG),
      input.fatG == null ? null : Math.round(input.fatG),
      input.carbsG == null ? null : Math.round(input.carbsG),
      input.quickAdd ?? false,
      input.defaultSlot ?? null,
      input.perGrams ?? null,
    ],
  );
  return toFood(rows[0]!);
}

export async function updateFood(
  ctx: Ctx,
  id: number,
  input: Partial<SaveFoodInput>,
): Promise<Food> {
  const current = await getFood(ctx, id);
  const { rows } = await ctx.db.query<FoodRow>(
    `update foods set name = $3, kcal = $4, protein_g = $5, fat_g = $6, carbs_g = $7,
                      quick_add = $8, default_slot = $9
     where id = $2 and user_id = $1
     -- per_grams and last_grams are deliberately not in the SET list: editing
     -- the macros of a scanned product must not turn it back into a portion.
     -- They are in RETURNING because leaving them out hands the screen an
     -- undefined basis, which reads as "this is a portion" — the same bug
     -- migration 027 exists to end.
     returning id, name, kcal, protein_g, fat_g, carbs_g, quick_add, default_slot,
               times_used, last_used_at, per_grams, last_grams`,
    [
      ctx.userId,
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
export async function archiveFood(ctx: Ctx, id: number): Promise<void> {
  const { rowCount } = await ctx.db.query(
    'update foods set archived = true where id = $1 and user_id = $2',
    [id, ctx.userId],
  );
  if (!rowCount) throw notFound(`No food ${id}`);
}

export async function recordUse(ctx: Ctx, id: number): Promise<void> {
  await ctx.db.query(
    'update foods set times_used = times_used + 1, last_used_at = now() where id = $1 and user_id = $2',
    [id, ctx.userId],
  );
}


/**
 * Remember the portion, so the next scan opens on what they actually ate
 * rather than on the number the label happens to be printed against.
 *
 * Best effort by design: this runs after the meal is already written, and
 * failing to remember a convenience must never fail the log.
 */
export async function rememberPortion(ctx: Ctx, foodId: number, grams: number): Promise<void> {
  await ctx.db.query(
    'update foods set last_grams = $3 where user_id = $1 and id = $2 and per_grams is not null',
    [ctx.userId, foodId, Math.round(grams)],
  );
}
