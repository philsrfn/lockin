import { type Queryable, pool } from '../db';
import { badRequest } from '../errors';
import { type Macros, sumMacros } from '../domain/macros';

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type Meal = {
  id: number;
  eatenAt: string;
  slot: MealSlot;
  description: string | null;
  kcal: number | null;
  proteinG: number | null;
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
  source: string | null;
};

const toMeal = (row: MealRow): Meal => ({
  id: row.id,
  eatenAt: row.eaten_at.toISOString(),
  slot: row.slot as MealSlot,
  description: row.description,
  kcal: row.kcal,
  proteinG: row.protein_g,
  source: row.source,
});

export type LogMealInput = {
  slot: MealSlot;
  description: string;
  kcal?: number | null;
  proteinG?: number | null;
  source?: string | null;
  eatenAt?: string;
};

/**
 * Phase 4 builds the food *screen*. The table and the arithmetic exist now, so
 * the trainer can log a meal the moment he mentions one in chat.
 */
export async function logMeal(input: LogMealInput, db: Queryable = pool): Promise<{
  meal: Meal;
  today: Macros;
}> {
  if (!SLOTS.includes(input.slot)) {
    throw badRequest(`slot must be one of ${SLOTS.join(', ')}`);
  }

  const { rows } = await db.query<MealRow>(
    `insert into meals (eaten_at, slot, description, kcal, protein_g, source)
     values (coalesce($1::timestamptz, now()), $2, $3, $4, $5, $6)
     returning id, eaten_at, slot, description, kcal, protein_g, source`,
    [
      input.eatenAt ?? null,
      input.slot,
      input.description,
      input.kcal ?? null,
      input.proteinG ?? null,
      input.source ?? 'own',
    ],
  );

  return { meal: toMeal(rows[0]!), today: await macrosToday(db) };
}

export async function mealsToday(db: Queryable = pool): Promise<Meal[]> {
  const { rows } = await db.query<MealRow>(
    `select id, eaten_at, slot, description, kcal, protein_g, source
     from meals where eaten_at::date = current_date order by eaten_at`,
  );
  return rows.map(toMeal);
}

export async function macrosToday(db: Queryable = pool): Promise<Macros> {
  const meals = await mealsToday(db);
  return sumMacros(meals.map((meal) => ({ kcal: meal.kcal ?? 0, proteinG: meal.proteinG ?? 0 })));
}
