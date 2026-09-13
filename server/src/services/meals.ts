import type { Ctx } from '../db';
import { badRequest, notFound } from '../errors';
import { type Macros, sumMacros } from '../domain/macros';
import { dayIn, dayRangeIn } from '../domain/time';
import { athleteZone } from './clock';
import { createFood, recordUse } from './foods';
import { earnsItsPlace, libraryKeyFor } from '../domain/foodLibrary';

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
/**
 * The library growing by use (§4), from every way of logging rather than one.
 *
 * A barcode scan saved a food; describing a meal in words did not, and
 * neither did telling the trainer about it in chat. So for anybody who logs
 * by talking the quick-add tiles stayed empty forever, and the structured
 * screen that §11 builds on had nothing in it to tap.
 *
 * The second time, not the first. A restaurant meal nobody repeats is a meal;
 * the thing eaten on Tuesday and again on Thursday is a staple, and only the
 * staple is worth a tile. `domain/foodLibrary.ts` holds the rule.
 *
 * A portion, never per 100 g: the description says what was eaten, not what a
 * label says about a hundred grams of it. Migration 027 exists because those
 * two were once the same column.
 */
async function rememberIfItRepeats(ctx: Ctx, input: LogMealInput): Promise<number | null> {
  const key = libraryKeyFor(input);
  if (!key) return null;

  const { rows } = await ctx.db.query<{ eaten: number }>(
    `select count(*)::int as eaten from meals
     where user_id = $1 and lower(btrim(description)) = $2`,
    [ctx.userId, key],
  );
  if (!earnsItsPlace(rows[0]?.eaten ?? 0)) return null;

  const food = await createFood(ctx, {
    name: input.description.trim(),
    kcal: input.kcal!,
    proteinG: input.proteinG!,
    fatG: input.fatG ?? null,
    carbsG: input.carbsG ?? null,
    defaultSlot: input.slot,
    perGrams: null,
  });
  return food.id;
}

export async function logMeal(
  ctx: Ctx,
  input: LogMealInput,
  zone?: string,
): Promise<{ meal: Meal; today: Macros }> {
  const timezone = zone ?? (await athleteZone(ctx));

  if (!SLOTS.includes(input.slot)) {
    throw badRequest(`slot must be one of ${SLOTS.join(', ')}`);
  }

  const foodId = input.foodId ?? (await rememberIfItRepeats(ctx, input));

  const { rows } = await ctx.db.query<MealRow>(
    `insert into meals
       (user_id, eaten_at, slot, description, kcal, protein_g, fat_g, carbs_g, food_id, source)
     values ($1, coalesce($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9, $10)
     returning ${MEAL_COLUMNS}`,
    [
      ctx.userId,
      input.eatenAt ?? null,
      input.slot,
      input.description,
      input.kcal ?? null,
      input.proteinG ?? null,
      input.fatG ?? null,
      input.carbsG ?? null,
      foodId,
      input.source ?? 'own',
    ],
  );

  // Keeps the food screen ordered by what they actually reach for.
  if (foodId != null) await recordUse(ctx, foodId);

  return { meal: toMeal(rows[0]!), today: await macrosToday(ctx, timezone) };
}

/**
 * What he has eaten today, where "today" is his day — a dinner logged at 21:00
 * is that day's dinner in Boston as much as in Berlin.
 */
export async function mealsToday(ctx: Ctx, zone?: string): Promise<Meal[]> {
  const timezone = zone ?? (await athleteZone(ctx));
  const { from, until } = dayRangeIn(timezone, dayIn(timezone));

  const { rows } = await ctx.db.query<MealRow>(
    `select ${MEAL_COLUMNS} from meals
     where user_id = $1 and eaten_at >= $2 and eaten_at < $3
     order by eaten_at`,
    [ctx.userId, from, until],
  );
  return rows.map(toMeal);
}

/** Undo a mis-tap. Returns what today looks like afterwards. */
export async function deleteMeal(ctx: Ctx, id: number, zone?: string): Promise<{ today: Macros }> {
  const { rowCount } = await ctx.db.query('delete from meals where id = $1 and user_id = $2', [
    id,
    ctx.userId,
  ]);
  if (!rowCount) throw notFound(`No meal ${id}`);
  return { today: await macrosToday(ctx, zone) };
}

export async function macrosToday(ctx: Ctx, zone?: string): Promise<Macros> {
  const meals = await mealsToday(ctx, zone);
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
