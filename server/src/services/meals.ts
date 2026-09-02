import { type Queryable, pool } from '../db';
import { badRequest, notFound } from '../errors';
import { type Macros, sumMacros } from '../domain/macros';
import { dayIn, dayRangeIn } from '../domain/time';
import { athleteZone } from './clock';
import { recordUse } from './foods';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Meal = {
  id: number;
  eatenAt: string;
  slot: MealSlot;
  description: string | null;
  kcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  foodId: number | null;
  source: string | null;
};

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

type MealRow = {
  id: number;
  eaten_at: Date;
  slot: string;
  description: string | null;
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  food_id: number | null;
  source: string | null;
};

const toMeal = (row: MealRow): Meal => ({
  id: row.id,
  eatenAt: row.eaten_at.toISOString(),
  slot: row.slot as MealSlot,
  description: row.description,
  kcal: row.kcal,
  proteinG: row.protein_g,
  fatG: row.fat_g,
  carbsG: row.carbs_g,
  foodId: row.food_id,
  source: row.source,
});

const MEAL_COLUMNS =
  'id, eaten_at, slot, description, kcal, protein_g, fat_g, carbs_g, food_id, source';

export type LogMealInput = {
  slot: MealSlot;
  description: string;
  kcal?: number | null;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
  foodId?: number | null;
  source?: string | null;
  eatenAt?: string;
};

/**
 * Phase 4 builds the food *screen*. The table and the arithmetic exist now, so
 * the trainer can log a meal the moment he mentions one in chat.
 */
export async function logMeal(
  input: LogMealInput,
  db: Queryable = pool,
  zone?: string,
): Promise<{ meal: Meal; today: Macros }> {
  const timezone = zone ?? (await athleteZone(db));

  if (!SLOTS.includes(input.slot)) {
    throw badRequest(`slot must be one of ${SLOTS.join(', ')}`);
  }

  const { rows } = await db.query<MealRow>(
    `insert into meals (eaten_at, slot, description, kcal, protein_g, fat_g, carbs_g, food_id, source)
     values (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6, $7, $8, $9)
     returning ${MEAL_COLUMNS}`,
    [
      input.eatenAt ?? null,
      input.slot,
      input.description,
      input.kcal ?? null,
      input.proteinG ?? null,
      input.fatG ?? null,
      input.carbsG ?? null,
      input.foodId ?? null,
      input.source ?? 'own',
    ],
  );

  // Keeps the food screen ordered by what he actually reaches for.
  if (input.foodId != null) await recordUse(input.foodId, db);

  return { meal: toMeal(rows[0]!), today: await macrosToday(db, timezone) };
}

/**
 * What he has eaten today, where "today" is his day — a dinner logged at 21:00
 * is that day's dinner in Boston as much as in Berlin.
 */
export async function mealsToday(db: Queryable = pool, zone?: string): Promise<Meal[]> {
  const timezone = zone ?? (await athleteZone(db));
  const { from, until } = dayRangeIn(timezone, dayIn(timezone));

  const { rows } = await db.query<MealRow>(
    `select ${MEAL_COLUMNS} from meals
     where eaten_at >= $1 and eaten_at < $2
     order by eaten_at`,
    [from, until],
  );
  return rows.map(toMeal);
}

/** Undo a mis-tap. Returns what today looks like afterwards. */
export async function deleteMeal(
  id: number,
  db: Queryable = pool,
  zone?: string,
): Promise<{ today: Macros }> {
  const { rowCount } = await db.query('delete from meals where id = $1', [id]);
  if (!rowCount) throw notFound(`No meal ${id}`);
  return { today: await macrosToday(db, zone) };
}

export async function macrosToday(db: Queryable = pool, zone?: string): Promise<Macros> {
  const meals = await mealsToday(db, zone);
  return sumMacros(meals.map(mealToMacros));
}

/**
 * A logged meal as macro input. Kept as one named function so a new macro can
 * never be added to the schema and quietly forgotten in the daily total —
 * which is exactly what happened when fat and carbs were added.
 */
export function mealToMacros(meal: Meal) {
  return {
    kcal: meal.kcal ?? 0,
    proteinG: meal.proteinG ?? 0,
    fatG: meal.fatG ?? 0,
    carbsG: meal.carbsG ?? 0,
  };
}
